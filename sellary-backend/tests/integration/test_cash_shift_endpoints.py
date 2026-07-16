"""Till-shift API: open, snapshot, close, and the sale gate.

These manage shift state directly, so they opt out of the auto-opened shift.
"""
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from models.category import Category
from models.inventory_layer import InventoryLayer
from models.product import Product

pytestmark = pytest.mark.no_auto_shift


def _idem(headers: dict, key: str) -> dict:
    return {**headers, "Idempotency-Key": key if len(key) >= 16 else f"{key}-tenant-safe"}


def _backed_product(db_session):
    category = Category(name="Shift Cat")
    db_session.add(category)
    db_session.flush()
    product = Product(
        name="Shift Product",
        barcode=f"SH{uuid.uuid4().hex[:8]}",
        category_id=category.id,
        cost_price=Decimal("5.00"),
        sell_price=Decimal("10.00"),
        stock_quantity=Decimal("100.000"),
        inventory_value=Decimal("500.0000"),
    )
    db_session.add(product)
    db_session.flush()
    db_session.add(
        InventoryLayer(
            company_id=product.company_id,
            product_id=product.id,
            source_type="opening_balance",
            source_id=None,
            original_quantity=Decimal("100.000"),
            remaining_quantity=Decimal("100.000"),
            unit_cost=Decimal("5.00"),
        )
    )
    db_session.commit()
    return product


class TestSaleGate:
    def test_sale_rejected_without_open_shift(self, client, db_session, cashier_headers):
        product = _backed_product(db_session)
        response = client.post(
            "/api/sales",
            headers=_idem(cashier_headers, "gate-no-shift"),
            json={
                "items": [{"product_id": product.id, "quantity": 1, "unit_price": "10.00"}],
                "payment_method": "cash",
            },
        )
        assert response.status_code == 409
        assert "Смена" in response.json()["detail"]

    def test_sale_allowed_after_opening_a_shift(self, client, db_session, cashier_headers):
        product = _backed_product(db_session)
        opened = client.post("/api/shifts/open", headers=cashier_headers, json={"opening_cash": "50.00"})
        assert opened.status_code == 201

        response = client.post(
            "/api/sales",
            headers=_idem(cashier_headers, "gate-with-shift"),
            json={
                "items": [{"product_id": product.id, "quantity": 1, "unit_price": "10.00"}],
                "payment_method": "cash",
            },
        )
        assert response.status_code == 201


class TestShiftLifecycle:
    def test_current_is_null_then_reflects_open_shift(self, client, cashier_headers):
        assert client.get("/api/shifts/current", headers=cashier_headers).json() is None

        client.post("/api/shifts/open", headers=cashier_headers, json={"opening_cash": "100.00"})
        current = client.get("/api/shifts/current", headers=cashier_headers).json()
        assert current["status"] == "open"
        assert current["opening_cash"] == "100.00"
        # /shifts/current must resolve to this handler, not /{shift_id}.
        assert "totals" in current

    def test_second_open_conflicts(self, client, cashier_headers):
        client.post("/api/shifts/open", headers=cashier_headers, json={"opening_cash": "0.00"})
        second = client.post("/api/shifts/open", headers=cashier_headers, json={"opening_cash": "0.00"})
        assert second.status_code == 409

    def test_snapshot_does_not_close_the_shift(self, client, cashier_headers):
        opened = client.post("/api/shifts/open", headers=cashier_headers, json={"opening_cash": "0.00"}).json()
        snap = client.post(f"/api/shifts/{opened['id']}/snapshots", headers=cashier_headers)
        assert snap.status_code == 201
        assert "totals" in snap.json()
        # Still open.
        assert client.get("/api/shifts/current", headers=cashier_headers).json()["status"] == "open"

    def test_close_records_discrepancy_and_reclose_conflicts(
        self, client, db_session, cashier_headers
    ):
        product = _backed_product(db_session)
        opened = client.post(
            "/api/shifts/open", headers=cashier_headers, json={"opening_cash": "50.00"}
        ).json()

        client.post(
            "/api/sales",
            headers=_idem(cashier_headers, "close-flow-sale"),
            json={
                "items": [{"product_id": product.id, "quantity": 2, "unit_price": "10.00"}],
                "payment_method": "cash",
            },
        )
        # Expected 50 + 20 = 70; count 68 → 2 short.
        closed = client.post(
            f"/api/shifts/{opened['id']}/close",
            headers=cashier_headers,
            json={"counted_cash": "68.00"},
        )
        assert closed.status_code == 200
        body = closed.json()
        assert body["expected_cash"] == "70.00"
        assert body["discrepancy"] == "-2.00"

        reclose = client.post(
            f"/api/shifts/{opened['id']}/close",
            headers=cashier_headers,
            json={"counted_cash": "70.00"},
        )
        assert reclose.status_code == 409

    def test_closed_totals_frozen_against_a_later_sale(self, client, db_session, cashier_headers):
        product = _backed_product(db_session)
        opened = client.post(
            "/api/shifts/open", headers=cashier_headers, json={"opening_cash": "0.00"}
        ).json()
        client.post(
            "/api/sales",
            headers=_idem(cashier_headers, "freeze-sale-1"),
            json={
                "items": [{"product_id": product.id, "quantity": 1, "unit_price": "10.00"}],
                "payment_method": "cash",
            },
        )
        closed = client.post(
            f"/api/shifts/{opened['id']}/close", headers=cashier_headers, json={"counted_cash": "10.00"}
        ).json()
        frozen_expected = closed["expected_cash"]

        # Open a new shift and sell again; the closed shift must not change.
        client.post("/api/shifts/open", headers=cashier_headers, json={"opening_cash": "0.00"})
        client.post(
            "/api/sales",
            headers=_idem(cashier_headers, "freeze-sale-2"),
            json={
                "items": [{"product_id": product.id, "quantity": 5, "unit_price": "10.00"}],
                "payment_method": "cash",
            },
        )
        detail = client.get(f"/api/shifts/{opened['id']}", headers=cashier_headers).json()
        assert detail["expected_cash"] == frozen_expected == "10.00"
