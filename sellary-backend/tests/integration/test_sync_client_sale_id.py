"""C3: sales.client_sale_id persistence, re-sync duplicate, partial unique index."""
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import create_auth_headers


def _payload(product_id, client_sale_id, idempotency_key):
    return {
        "sales": [
            {
                "client_sale_id": client_sale_id,
                "idempotency_key": idempotency_key,
                "created_at_client": datetime.now(timezone.utc).isoformat(),
                "payment_method": "cash",
                "discount_amount": "0.00",
                "paid_amount": "30.00",
                "change_amount": "0.00",
                "items": [
                    {"product_id": product_id, "quantity": "2.000", "sell_price": "15.00"}
                ],
            }
        ]
    }


class TestClientSaleId:
    def test_client_sale_id_persisted_on_synced_sale(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        from models.sale import Sale

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        resp = client.post(
            "/api/sync/sales",
            json=_payload(test_product.id, "csid-persist-1", "ik-persist-1"),
            headers=headers,
        )
        sale_id = resp.json()["results"][0]["sale_id"]
        sale = db_session.get(Sale, sale_id)
        assert sale.client_sale_id == "csid-persist-1"

    def test_resync_same_client_sale_id_is_duplicate(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        body = _payload(test_product.id, "csid-dup-1", "ik-dup-c3")
        first = client.post("/api/sync/sales", json=body, headers=headers).json()
        second = client.post("/api/sync/sales", json=body, headers=headers).json()
        assert first["results"][0]["status"] == "synced"
        assert second["results"][0]["status"] == "duplicate"
        assert second["results"][0]["sale_id"] == first["results"][0]["sale_id"]

    def test_partial_unique_index_blocks_duplicate_but_allows_nulls(
        self, db_session, default_company, cashier_user, test_product
    ):
        from models.sale import PaymentMethod, Sale, SaleStatus

        def _mk(client_sale_id):
            return Sale(
                company_id=default_company.id,
                cashier_id=cashier_user.id,
                payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED,
                client_sale_id=client_sale_id,
            )

        # Two NULL client_sale_id rows (the online path) coexist fine.
        db_session.add(_mk(None))
        db_session.add(_mk(None))
        db_session.flush()

        # Two identical non-NULL client_sale_id rows in one company collide.
        db_session.add(_mk("same-csid"))
        db_session.flush()
        db_session.add(_mk("same-csid"))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()
