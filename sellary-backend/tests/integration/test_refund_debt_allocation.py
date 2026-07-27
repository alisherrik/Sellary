"""A refund must not pay out what the debt already absorbed.

The bug these cover: a return did two independent things — it wrote the
customer's debt down by up to the refunded amount, and it recorded the whole
refunded amount as money leaving the till. Nothing compared the two, so
returning goods from a sale that still owed money both cancelled the debt and
handed over the cash. The shop gave back more than it ever took.

It needed the cashier to pick a money refund method on a sale that owed
money — which is exactly what a split sale invites, because it files itself
under its largest tender and the screen says «Наличные» with no hint that part
of it is on the tab.
"""

from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from repositories.money_repository import MoneyRepository
from services.cash_shift_service import CashShiftService

# Everything the suite creates happens after this.
#
# The account-balance and shift queries filter on `created_at >= <an anchor>`,
# and on the SQLite test engine that comparison is done between strings: the
# bound Python datetime renders with microseconds while `func.now()` stores
# none, so an equal instant compares greater and the row drops out. Postgres
# compares real timestamps and is unaffected. Anchoring the assertions well in
# the past exercises the same SQL without tripping over it.
LONG_AGO = datetime(2000, 1, 1)


def _with_idempotency(headers, key):
    return {**headers, "Idempotency-Key": key}


def _items(product_id, quantity="1.000", unit_price="50.00"):
    return [
        {
            "product_id": product_id,
            "quantity": quantity,
            "unit_price": unit_price,
            "tax_percent": "0.00",
        }
    ]


def _cash_paid_out(db_session, company_id) -> Decimal:
    """What the money layer thinks has left the drawer as refunds."""
    return MoneyRepository(db_session)._sum_refunds(company_id, "cash", LONG_AGO)


def _shift_cash_refunds(db_session, company_id) -> Decimal:
    totals = CashShiftService(db_session, company_id).compute_totals(
        LONG_AGO, None, Decimal("0.00")
    )
    return totals.refunds_by_method.get("cash", Decimal("0.00"))


class TestTheWorkedExample:
    """50 сомони: 26 наличными + 10 DC + 10 Эсхата + 4 в долг, all returned."""

    @pytest.fixture
    def sale(self, client: TestClient, cashier_headers, test_customer, test_product):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "refund-alloc-sale"),
            json={
                "customer_id": test_customer.id,
                "items": _items(test_product.id),
                "payments": [
                    {"method": "cash", "amount": "26.00"},
                    {"method": "card", "card_type": "dc", "amount": "10.00"},
                    {"method": "card", "card_type": "eskhata", "amount": "10.00"},
                    {"method": "credit", "amount": "4.00"},
                ],
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    def _return_everything(self, client, admin_headers, sale, key):
        return client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, key),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                # The wrong-looking choice a cashier would make: the screen says
                # «Наличные», because that is the largest tender.
                "refund_method": "cash",
                "notes": "Вернули весь товар",
            },
        )

    def test_only_the_money_half_is_paid_back(
        self, client, admin_headers, sale
    ):
        body = self._return_everything(
            client, admin_headers, sale, "refund-alloc-full"
        ).json()
        assert body["total_refund_amount"] == "50.00"
        assert body["credit_refund_amount"] == "4.00"
        assert body["money_refund_amount"] == "46.00"

    def test_the_two_halves_add_up_to_the_goods_returned(
        self, client, admin_headers, sale
    ):
        body = self._return_everything(
            client, admin_headers, sale, "refund-alloc-adds-up"
        ).json()
        assert Decimal(body["credit_refund_amount"]) + Decimal(
            body["money_refund_amount"]
        ) == Decimal(body["total_refund_amount"])

    def test_the_debt_is_cleared(
        self, client, admin_headers, cashier_headers, test_customer, sale
    ):
        self._return_everything(client, admin_headers, sale, "refund-alloc-debt")
        balance = client.get(
            f"/api/customers/{test_customer.id}", headers=cashier_headers
        ).json()["balance"]
        assert balance == "0.00"

    def test_the_drawer_gives_back_46_not_50(
        self, client, db_session, admin_headers, default_company, sale
    ):
        """The whole point. 50 out of a drawer that took 26 was the bug."""
        self._return_everything(client, admin_headers, sale, "refund-alloc-till")
        assert _cash_paid_out(db_session, default_company.id) == Decimal("46.00")

    def test_the_shift_reports_the_money_half(
        self, client, db_session, admin_headers, default_company, sale
    ):
        self._return_everything(client, admin_headers, sale, "refund-alloc-shift")
        assert _shift_cash_refunds(db_session, default_company.id) == Decimal("46.00")


class TestAPureDebtSale:
    """The older, worse shape of the same bug: nothing was ever paid."""

    @pytest.fixture
    def sale(self, client: TestClient, cashier_headers, test_customer, test_product):
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "refund-alloc-credit-sale"),
            json={
                "customer_id": test_customer.id,
                "items": _items(test_product.id),
                "payment_method": "credit",
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_no_money_leaves_the_drawer(
        self, client, db_session, admin_headers, default_company, sale
    ):
        body = client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, "refund-alloc-credit-return"),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                "refund_method": "cash",
            },
        ).json()

        assert body["credit_refund_amount"] == "50.00"
        assert body["money_refund_amount"] == "0.00"
        assert _cash_paid_out(db_session, default_company.id) == Decimal("0.00")


class TestPartialReturns:
    @pytest.fixture
    def sale(self, client: TestClient, cashier_headers, test_customer, test_product):
        """100 сомони over two units: 60 наличными, 40 в долг."""
        response = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "refund-alloc-partial-sale"),
            json={
                "customer_id": test_customer.id,
                "items": _items(test_product.id, quantity="2.000", unit_price="50.00"),
                "payments": [
                    {"method": "cash", "amount": "60.00"},
                    {"method": "credit", "amount": "40.00"},
                ],
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_a_return_smaller_than_the_debt_pays_out_nothing(
        self, client, db_session, admin_headers, default_company, sale
    ):
        body = client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, "refund-alloc-partial-1"),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                "refund_method": "cash",
            },
        ).json()

        # 50 returned against a 40 debt: 40 written off, 10 handed over.
        assert body["credit_refund_amount"] == "40.00"
        assert body["money_refund_amount"] == "10.00"
        assert _cash_paid_out(db_session, default_company.id) == Decimal("10.00")

    def test_a_second_return_finds_no_debt_left_and_pays_in_full(
        self, client, db_session, admin_headers, default_company, sale
    ):
        client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, "refund-alloc-partial-a"),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                "refund_method": "cash",
            },
        )
        body = client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, "refund-alloc-partial-b"),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                "refund_method": "cash",
            },
        ).json()

        assert body["credit_refund_amount"] == "0.00"
        assert body["money_refund_amount"] == "50.00"
        # 40 written off on the first return, 10 paid; then 50 paid in full.
        assert _cash_paid_out(db_session, default_company.id) == Decimal("60.00")

    def test_the_shop_never_gives_back_more_than_it_took(
        self, client, db_session, admin_headers, default_company, sale
    ):
        """Both returns together: 100 of goods, 60 of money — what came in."""
        for index in ("x", "y"):
            client.post(
                f"/api/sales/{sale['id']}/return",
                headers=_with_idempotency(admin_headers, f"refund-alloc-both-{index}"),
                json={
                    "items": [
                        {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                    ],
                    "refund_method": "cash",
                },
            )
        assert _cash_paid_out(db_session, default_company.id) == Decimal("60.00")


class TestAnOrdinarySaleIsUnchanged:
    def test_a_plain_cash_sale_refunds_in_full(
        self, client, db_session, admin_headers, cashier_headers, default_company, test_product
    ):
        sale = client.post(
            "/api/sales",
            headers=_with_idempotency(cashier_headers, "refund-alloc-plain-sale"),
            json={"items": _items(test_product.id), "payment_method": "cash"},
        ).json()

        body = client.post(
            f"/api/sales/{sale['id']}/return",
            headers=_with_idempotency(admin_headers, "refund-alloc-plain-return"),
            json={
                "items": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": "1.000"}
                ],
                "refund_method": "cash",
            },
        ).json()

        assert body["credit_refund_amount"] == "0.00"
        assert body["money_refund_amount"] == "50.00"
        # No debt to absorb any of it, so the whole 50 leaves the drawer —
        # exactly as it did before this change.
        assert _cash_paid_out(db_session, default_company.id) == Decimal("50.00")
