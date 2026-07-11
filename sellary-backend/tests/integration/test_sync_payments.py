"""C5: /api/sync/payments — cap-to-balance, overpayment warning, idempotency."""
from datetime import datetime, timezone

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
                "name": "Платёжник",
                "phone": phone,
            }
        ]
    }
    return client.post("/api/sync/customers", json=body, headers=headers).json()[
        "results"
    ][0]["server_id"]


def _make_debt(client, headers, client_customer_id, client_sale_id, idem, product_id):
    """Create an open credit sale so the customer has a reducible balance.

    2 x 15.00 = 30.00 subtotal, but test_product carries tax_percent=10.00,
    so the sync/sales credit route (services/sync_service.py) adds 3.00 tax
    -> total_amount = 33.00. The customer's ledger balance after this sale
    is therefore 33.00, not 30.00.
    """
    payload = {
        "sales": [
            {
                "client_sale_id": client_sale_id,
                "idempotency_key": idem,
                "created_at_client": datetime.now(timezone.utc).isoformat(),
                "payment_method": "credit",
                "client_customer_id": client_customer_id,
                "discount_amount": "0.00",
                "paid_amount": "0.00",
                "change_amount": "0.00",
                "items": [
                    {"product_id": product_id, "quantity": "2.000", "sell_price": "15.00"}
                ],
            }
        ]
    }
    client.post("/api/sync/sales", json=payload, headers=headers)


def _payment(client_payment_id, idempotency_key, client_customer_id, amount):
    return {
        "payments": [
            {
                "client_payment_id": client_payment_id,
                "idempotency_key": idempotency_key,
                "client_customer_id": client_customer_id,
                "amount": amount,
                "payment_method": "cash",
            }
        ]
    }


class TestSyncPayments:
    def test_partial_payment_applied_no_warning(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-pay-1", "+99290400001")
        _make_debt(client, headers, "cc-pay-1", "csid-pay-1", "ik-debt-1", test_product.id)

        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-1", "ik-pay-1234567890", "cc-pay-1", "20.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["applied_amount"] == "20.00"
        assert result["warnings"] is None

        balance = client.get(
            f"/api/customers/{server_id}", headers=headers
        ).json()["balance"]
        # Debt is 33.00 (30.00 subtotal + 10% tax) -> 33.00 - 20.00 = 13.00.
        assert balance == "13.00"

    def test_overpayment_capped_with_warning(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-pay-2", "+99290400002")
        _make_debt(client, headers, "cc-pay-2", "csid-pay-2", "ik-debt-2", test_product.id)

        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-2", "ik-pay-2234567890", "cc-pay-2", "50.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        # Debt is 33.00 (30.00 subtotal + 10% tax) -> capped to 33.00.
        assert result["applied_amount"] == "33.00"
        assert result["warnings"][0]["type"] == "overpayment"
        assert result["warnings"][0]["requested"] == "50.00"
        assert result["warnings"][0]["applied"] == "33.00"

        balance = client.get(
            f"/api/customers/{server_id}", headers=headers
        ).json()["balance"]
        assert balance == "0.00"

    def test_payment_is_idempotent(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-pay-3", "+99290400003")
        _make_debt(client, headers, "cc-pay-3", "csid-pay-3", "ik-debt-3", test_product.id)

        body = _payment("cp-3", "ik-pay-3234567890", "cc-pay-3", "20.00")
        first = client.post("/api/sync/payments", json=body, headers=headers).json()
        second = client.post("/api/sync/payments", json=body, headers=headers).json()
        assert first["results"][0]["status"] == "synced"
        assert second["results"][0]["status"] == "duplicate"
        assert second["results"][0]["applied_amount"] == "20.00"

        # Balance reduced exactly once: 33 - 20 = 13 (not 33 - 40).
        balance = client.get(
            f"/api/customers/{server_id}", headers=headers
        ).json()["balance"]
        assert balance == "13.00"

    def test_payment_on_zero_debt_skipped_with_warning(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        _push_customer(client, headers, "cc-pay-4", "+99290400004")  # no debt

        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-4", "ik-pay-4234567890", "cc-pay-4", "10.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["applied_amount"] == "0.00"
        assert result["warnings"][0]["type"] == "overpayment"

    def test_payment_unknown_customer_fails(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-5", "ik-pay-5234567890", "cc-missing", "10.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "failed"
        assert "not synced" in result["error"]
