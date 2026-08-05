"""A sale settled with several tenders, followed all the way to the reports.

The case this was built for, in the owner's words: a customer buys 50 сомони of
goods and hands over 26 наличными, 10 on a DC card, 10 on Эсхата, and asks for
the last 4 to go on their tab. All four have to survive — in the sale, in the
till, in the shift, and in what they owe.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from models.sale import PaymentMethod
from models.sale_payment import SalePayment
from services.cash_shift_service import CashShiftService
from services.money_service import MoneyService
from services.sale_service import SaleService


def _payload(customer_id, product_id, payments, quantity="1.000", unit_price="50.00"):
    return {
        "customer_id": customer_id,
        "items": [
            {
                "product_id": product_id,
                "quantity": quantity,
                "unit_price": unit_price,
                "tax_percent": "0.00",
            }
        ],
        "payments": payments,
    }


FOUR_WAYS = [
    {"method": "cash", "amount": "26.00"},
    {"method": "card", "card_type": "dc", "amount": "10.00"},
    {"method": "card", "card_type": "eskhata", "amount": "10.00"},
    {"method": "credit", "amount": "4.00"},
]


def _with_idempotency(headers, key):
    return {**headers, "Idempotency-Key": key}


class TestTheWorkedExample:
    @pytest.fixture
    def sale(self, client: TestClient, cashier_headers, test_customer, test_product):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-worked-example"),
            json=_payload(test_customer.id, test_product.id, FOUR_WAYS),
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_all_four_tenders_come_back_on_the_sale(self, sale):
        assert sale["is_split"] is True
        assert [
            (p["method"], p.get("card_type"), p["amount"]) for p in sale["payments"]
        ] == [
            ("cash", None, "26.00"),
            ("card", "dc", "10.00"),
            ("card", "eskhata", "10.00"),
            ("credit", None, "4.00"),
        ]

    def test_the_total_is_what_was_tendered(self, sale):
        assert sale["total_amount"] == "50.00"
        tendered = sum(Decimal(p["amount"]) for p in sale["payments"])
        assert tendered == Decimal("50.00")

    def test_the_sale_files_itself_under_its_largest_tender(self, sale):
        """For anything still reading the old column: 26 наличными is the most."""
        assert sale["payment_method"] == "cash"

    def test_only_four_is_owed(self, sale):
        assert sale["payment_status"] == "partial"
        assert sale["credit_remaining_amount"] == "4.00"

    def test_the_customer_owes_exactly_four(
        self, client, cashier_headers, test_customer, sale
    ):
        response = client.get(
            f"/api/customers/{test_customer.id}", headers=cashier_headers
        )
        assert response.json()["balance"] == "4.00"

    def test_the_debt_can_be_repaid(
        self, client, cashier_headers, test_customer, sale
    ):
        """A split sale must still be findable by a repayment.

        It files itself under `cash`, so anything matching open debts on
        `payment_method == credit` would never see it and the 4 would be
        unpayable.
        """
        response = client.post(
            f"/api/customers/{test_customer.id}/payments",
            headers=_with_idempotency(cashier_headers, "split-payment-repay"),
            json={"amount": "4.00", "payment_method": "cash"},
        )
        assert response.status_code == 201, response.text
        balance = client.get(
            f"/api/customers/{test_customer.id}", headers=cashier_headers
        ).json()["balance"]
        assert balance == "0.00"


class TestReportsSeeEachTender:
    @pytest.fixture
    def sale(
        self,
        client: TestClient,
        db_session,
        default_company,
        cashier_headers,
        test_customer,
        test_product,
    ):
        # An account's balance counts only what happened at or after its
        # `opening_at`, and SQLite stamps that column to the whole second. Left
        # to be created by the first `overview()` call, the till could land in
        # the second after the sale and read 0.00. A real drawer exists before
        # the sale too.
        MoneyService(db_session, default_company.id).ensure_accounts()
        db_session.flush()
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-reports"),
            json=_payload(test_customer.id, test_product.id, FOUR_WAYS),
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_the_summary_splits_the_one_sale_across_methods(
        self, client, cashier_headers, sale
    ):
        body = client.get("/api/sales/summary", headers=cashier_headers).json()
        assert Decimal(body["cash"]) >= Decimal("26.00")
        assert Decimal(body["card"]) >= Decimal("20.00")
        assert Decimal(body["credit"]) >= Decimal("4.00")

    def test_the_parts_add_back_up_to_the_turnover(
        self, client, cashier_headers, sale
    ):
        """What lets a cashier reconcile: the split has to be exhaustive."""
        body = client.get("/api/sales/summary", headers=cashier_headers).json()
        parts = sum(
            Decimal(body[key]) for key in ("cash", "card", "mobile", "credit")
        )
        assert parts == Decimal(body["turnover"])

    def test_filtering_by_card_finds_a_sale_that_was_only_partly_card(
        self, client, cashier_headers, sale
    ):
        body = client.get(
            "/api/sales/summary",
            params={"payment_method": "card"},
            headers=cashier_headers,
        ).json()
        assert body["count"] >= 1

    def test_the_shift_counts_each_tender_where_it_landed(
        self, db_session, default_company, sale
    ):
        service = CashShiftService(db_session, default_company.id)
        shift = service.get_current()
        totals = service.totals_for(shift)

        assert totals.cash_sales >= Decimal("26.00")
        assert totals.card_by_type.get("dc", Decimal("0")) >= Decimal("10.00")
        assert totals.card_by_type.get("eskhata", Decimal("0")) >= Decimal("10.00")
        assert totals.credit_sales >= Decimal("4.00")

    def test_the_split_sale_is_counted_once_not_four_times(
        self, db_session, default_company, sale
    ):
        service = CashShiftService(db_session, default_company.id)
        totals = service.totals_for(service.get_current())
        # The suite's fixtures may add sales of their own; what matters is that
        # four tenders did not become four sales.
        assert totals.sales_count < 4

    def test_the_money_accounts_route_each_tender_separately(
        self, db_session, default_company, sale
    ):
        overview = MoneyService(db_session, default_company.id).overview()
        by_name = {a.name: a.balance for a in overview.accounts}
        till = next(a.balance for a in overview.accounts if a.is_till)
        assert till >= Decimal("26.00")
        assert by_name.get("Банк · DC", Decimal("0")) == Decimal("10.00")
        assert by_name.get("Банк · Эсхата", Decimal("0")) == Decimal("10.00")

    def test_the_debt_leg_moves_no_money(self, db_session, default_company, sale):
        overview = MoneyService(db_session, default_company.id).overview()
        # 26 + 10 + 10 landed somewhere; the 4 on the tab did not.
        assert overview.total == Decimal("46.00")


class TestRejections:
    def test_payments_that_do_not_add_up_are_refused(
        self, client, cashier_headers, test_customer, test_product
    ):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-short"),
            json=_payload(
                test_customer.id,
                test_product.id,
                [
                    {"method": "cash", "amount": "26.00"},
                    {"method": "card", "card_type": "dc", "amount": "10.00"},
                    {"method": "credit", "amount": "3.00"},
                ],
            ),
        )
        assert response.status_code == 400
        assert "short" in response.json()["detail"]

    def test_a_credit_leg_without_a_customer_is_refused(
        self, client, cashier_headers, test_product
    ):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-no-customer"),
            json=_payload(
                None,
                test_product.id,
                [
                    {"method": "cash", "amount": "46.00"},
                    {"method": "credit", "amount": "4.00"},
                ],
            ),
        )
        assert response.status_code == 400

    def test_mixing_the_two_request_shapes_is_refused(
        self, client, cashier_headers, test_customer, test_product
    ):
        """Sending both is sending a contradiction, so it is not guessed at."""
        payload = _payload(
            test_customer.id, test_product.id, [{"method": "cash", "amount": "50.00"}]
        )
        payload["payment_method"] = "card"
        payload["card_type"] = "dc"
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-both-shapes"),
            json=payload,
        )
        assert response.status_code == 422


class TestTheOlderShapeStillWorks:
    """The offline cashier keeps sending scalars until it ships its own change."""

    def test_a_plain_cash_sale_writes_one_tender(
        self, client, db_session, cashier_headers, test_product
    ):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-legacy-cash"),
            json={
                "items": [
                    {
                        "product_id": test_product.id,
                        "quantity": "1.000",
                        "unit_price": "50.00",
                        "tax_percent": "0.00",
                    }
                ],
                "payment_method": "cash",
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["is_split"] is False
        assert [(p["method"], p["amount"]) for p in body["payments"]] == [
            ("cash", "50.00")
        ]

    def test_a_credit_sale_with_a_prepayment_writes_two_tenders(
        self, client, db_session, cashier_headers, test_customer, test_product
    ):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-legacy-credit"),
            json={
                "customer_id": test_customer.id,
                "items": [
                    {
                        "product_id": test_product.id,
                        "quantity": "1.000",
                        "unit_price": "50.00",
                        "tax_percent": "0.00",
                    }
                ],
                "payment_method": "credit",
                "paid_amount": "20.00",
                "initial_payment_method": "cash",
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert [(p["method"], p["amount"]) for p in body["payments"]] == [
            ("cash", "20.00"),
            ("credit", "30.00"),
        ]
        rows = (
            db_session.query(SalePayment)
            .filter(SalePayment.sale_id == body["id"])
            .all()
        )
        assert sum(row.amount for row in rows) == Decimal("50.00")


class TestReturningASplitSale:
    """A return has to find the debt, whatever the sale files itself under."""

    @pytest.fixture
    def sale(self, client: TestClient, cashier_headers, test_customer, test_product):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "split-payment-return"),
            json=_payload(test_customer.id, test_product.id, FOUR_WAYS),
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_a_return_clears_the_debt_before_anything_else(
        self, client, cashier_headers, admin_headers, test_customer, sale
    ):
        response = client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, "split-payment-return-1"),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                "refund_method": "credit",
                "notes": "Вернули товар",
            },
        )
        assert response.status_code == 201, response.text

        balance = client.get(
            f"/api/customers/{test_customer.id}", headers=cashier_headers
        ).json()["balance"]
        assert balance == "0.00", "the 4 on the tab must not survive the return"
