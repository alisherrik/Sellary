"""C4: credit routing in /api/sync/sales; cash/card/mobile regression."""
from datetime import datetime, timezone

from models.sale import PaymentMethod, Sale
from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def _push_customer(client, headers, client_customer_id, phone):
    body = {
        "customers": [
            {
                "client_customer_id": client_customer_id,
                "name": "Кредитник",
                "phone": phone,
            }
        ]
    }
    return client.post("/api/sync/customers", json=body, headers=headers).json()[
        "results"
    ][0]["server_id"]


def _sale_item(product_id):
    return {"product_id": product_id, "quantity": "2.000", "sell_price": "15.00"}


def _base_sale(client_sale_id, idempotency_key, product_id, **overrides):
    payload = {
        "client_sale_id": client_sale_id,
        "idempotency_key": idempotency_key,
        "created_at_client": datetime.now(timezone.utc).isoformat(),
        "payment_method": "cash",
        "discount_amount": "0.00",
        "paid_amount": "30.00",
        "change_amount": "0.00",
        "items": [_sale_item(product_id)],
    }
    payload.update(overrides)
    return {"sales": [payload]}


class TestCreditSaleSync:
    def test_credit_sale_routes_to_ledger(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-cr-1", "+99290300001")

        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-1",
                "ik-cr-1",
                test_product.id,
                payment_method="credit",
                client_customer_id="cc-cr-1",
                paid_amount="0.00",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"

        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.CREDIT
        assert sale.customer_id == server_id
        assert sale.payment_status == "unpaid"

        ledger = client.get(
            f"/api/customers/{server_id}/ledger", headers=headers
        ).json()
        # test_product has tax_percent=10.00: 2 x 15.00 = 30.00 subtotal + 3.00
        # tax = 33.00 total_amount, which is what the ledger owes on credit.
        assert ledger["balance"] == "33.00"
        assert ledger["entries"][0]["entry_type"] == "credit_sale"

    def test_credit_sale_with_initial_payment_is_partial(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-cr-2", "+99290300002")

        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-2",
                "ik-cr-2",
                test_product.id,
                payment_method="credit",
                client_customer_id="cc-cr-2",
                paid_amount="10.00",
                initial_payment_method="cash",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_status == "partial"

        ledger = client.get(
            f"/api/customers/{server_id}/ledger", headers=headers
        ).json()
        # total_amount 33.00 (see above) minus the 10.00 initial payment.
        assert ledger["balance"] == "23.00"

    def test_credit_sale_without_client_customer_id_fails(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-3",
                "ik-cr-3",
                test_product.id,
                payment_method="credit",
                paid_amount="0.00",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "failed"
        assert "client_customer_id" in result["error"]

    def test_credit_sale_unknown_customer_fails(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-4",
                "ik-cr-4",
                test_product.id,
                payment_method="credit",
                client_customer_id="cc-does-not-exist",
                paid_amount="0.00",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "failed"
        assert "not synced" in result["error"]


class TestNonCreditRegression:
    def test_cash_sale_unchanged(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale("csid-cash-1", "ik-cash-1", test_product.id),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.CASH
        assert sale.customer_id is None
        assert sale.payment_status == "paid"

    def test_card_sale_unchanged(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-card-1",
                "ik-card-1",
                test_product.id,
                payment_method="card",
                card_type="alif",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.CARD
        assert sale.customer_id is None

    def test_mobile_sale_unchanged(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-mob-1", "ik-mob-1", test_product.id, payment_method="mobile"
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.MOBILE
        assert sale.customer_id is None
