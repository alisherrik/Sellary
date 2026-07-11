"""C1: sync path tolerates oversell; online POST /api/sales stays strict."""
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from tests.conftest import create_auth_headers


def _oversell_payload(product_id, qty="150.000"):
    return {
        "sales": [
            {
                "client_sale_id": "off-oversell-1",
                "idempotency_key": "ik-oversell-1",
                "created_at_client": datetime.now(timezone.utc).isoformat(),
                "payment_method": "cash",
                "discount_amount": "0.00",
                "paid_amount": "0.00",
                "change_amount": "0.00",
                "items": [
                    {"product_id": product_id, "quantity": qty, "sell_price": "15.00"}
                ],
            }
        ]
    }


class TestSyncOversellTolerant:
    def test_sync_oversell_returns_synced_with_warning(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        # test_product has stock 100; selling 150 oversells by 50.
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        response = client.post(
            "/api/sync/sales", json=_oversell_payload(test_product.id), headers=headers
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["status"] == "synced"
        assert result["sale_id"] is not None
        assert result["warnings"] is not None
        warning = result["warnings"][0]
        assert warning["type"] == "oversell"
        assert warning["product_id"] == test_product.id
        assert Decimal(warning["requested"]) == Decimal("150")
        assert Decimal(warning["available"]) == Decimal("100")
        assert Decimal(warning["new_balance"]) == Decimal("-50")


class TestOnlineSaleStaysStrict:
    def test_online_sale_rejects_oversell(
        self, db_session, default_company, cashier_user, test_product
    ):
        from schemas.sale import PaymentMethod, SaleCreate, SaleItemCreate
        from services.sale_service import SaleService

        service = SaleService(db_session, default_company.id)
        with pytest.raises(ValueError, match="Insufficient stock"):
            service.create(
                SaleCreate(
                    items=[
                        SaleItemCreate(
                            product_id=test_product.id,
                            quantity=Decimal("150"),
                            unit_price=Decimal("15.00"),
                            tax_percent=Decimal("0.00"),
                        )
                    ],
                    payment_method=PaymentMethod.CASH,
                ),
                cashier_user.id,
            )
