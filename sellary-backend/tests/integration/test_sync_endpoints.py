"""
Integration tests for sync API endpoints.
"""
import pytest
from datetime import datetime, timezone
from decimal import Decimal

from tests.conftest import create_auth_headers


class TestBootstrapEndpoint:
    """Tests for GET /api/sync/bootstrap."""

    def test_bootstrap_endpoint(
        self, client, db_session, default_company, admin_user, test_product, test_category
    ):
        headers = create_auth_headers(
            admin_user.username, admin_user.id,
            default_company.id, admin_user.role,
        )
        response = client.get("/api/sync/bootstrap", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["company_id"] == default_company.id
        assert data["company_name"] == default_company.name
        assert data["user_id"] == admin_user.id
        assert data["user_username"] == admin_user.username
        assert data["user_role"] == admin_user.role
        assert data["server_time"] is not None
        assert len(data["products"]) >= 1
        assert len(data["categories"]) >= 1

    def test_bootstrap_requires_auth(self, client):
        response = client.get("/api/sync/bootstrap")
        assert response.status_code == 401

    def test_bootstrap_tenant_isolation(
        self, client, db_session, default_company, secondary_company, admin_user
    ):
        from models.product import Product
        product = Product(
            company_id=secondary_company.id,
            name="Other Product",
            barcode="OTHER001",
            cost_price=Decimal("5.00"),
            sell_price=Decimal("10.00"),
            stock_quantity=50,
        )
        db_session.add(product)
        db_session.flush()

        headers = create_auth_headers(
            admin_user.username, admin_user.id,
            default_company.id, admin_user.role,
        )
        response = client.get("/api/sync/bootstrap", headers=headers)

        assert response.status_code == 200
        data = response.json()
        product_ids = {p["id"] for p in data["products"]}
        assert product.id not in product_ids


class TestSyncSalesEndpoint:
    """Tests for POST /api/sync/sales."""

    def _sale_payload(self, client_sale_id="off-001", idempotency_key="ik-001",
                      product_id=1, **kwargs):
        defaults = {
            "client_sale_id": client_sale_id,
            "idempotency_key": idempotency_key,
            "created_at_client": datetime.now(timezone.utc).isoformat(),
            "payment_method": "cash",
            "discount_amount": "0.00",
            "paid_amount": "30.00",
            "change_amount": "0.00",
            "items": [
                {
                    "product_id": product_id,
                    "quantity": "2.000",
                    "sell_price": "15.00",
                }
            ],
        }
        defaults.update(kwargs)
        return defaults

    def test_sync_sales_endpoint(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        payload = {
            "sales": [
                self._sale_payload(
                    client_sale_id="offline-001",
                    idempotency_key="ik-integration-001",
                    product_id=test_product.id,
                )
            ]
        }

        response = client.post("/api/sync/sales", json=payload, headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 1
        assert data["results"][0]["status"] == "synced"
        assert data["results"][0]["sale_id"] is not None

    def test_sync_sales_idempotency(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        payload = {
            "sales": [
                self._sale_payload(
                    client_sale_id="offline-dup",
                    idempotency_key="ik-dup-001",
                    product_id=test_product.id,
                )
            ]
        }

        response1 = client.post("/api/sync/sales", json=payload, headers=headers)
        assert response1.status_code == 200
        data1 = response1.json()
        assert data1["results"][0]["status"] == "synced"

        response2 = client.post("/api/sync/sales", json=payload, headers=headers)
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2["results"][0]["status"] == "duplicate"
        assert data2["results"][0]["sale_id"] == data1["results"][0]["sale_id"]

    def test_sync_sales_requires_auth(self, client, test_product):
        payload = {
            "sales": [
                self._sale_payload(product_id=test_product.id),
            ]
        }
        response = client.post("/api/sync/sales", json=payload)
        assert response.status_code == 401

    def test_sync_sales_batch(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        payload = {
            "sales": [
                self._sale_payload(
                    client_sale_id="batch-a",
                    idempotency_key="ik-batch-a",
                    product_id=test_product.id,
                    quantity="1.000",
                ),
                self._sale_payload(
                    client_sale_id="batch-b",
                    idempotency_key="ik-batch-b",
                    product_id=test_product.id,
                    quantity="2.000",
                ),
            ]
        }

        response = client.post("/api/sync/sales", json=payload, headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 2
        assert data["results"][0]["status"] == "synced"
        assert data["results"][1]["status"] == "synced"

    def test_sync_sales_missing_product(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        payload = {
            "sales": [
                self._sale_payload(
                    client_sale_id="off-bad",
                    idempotency_key="ik-bad",
                    product_id=99999,
                )
            ]
        }

        response = client.post("/api/sync/sales", json=payload, headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["status"] == "failed"
        assert "not found" in data["results"][0]["error"].lower()
