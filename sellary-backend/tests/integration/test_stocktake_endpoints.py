"""Integration tests for POST /api/inventory/stocktake.

The stocktake endpoint replaces the product-edit form's silent stock write. It
takes an *absolute* counted quantity plus the quantity the operator was shown,
so a stale page can no longer apply a delta to a figure that moved underneath
it. See docs/superpowers/specs/2026-08-04-stocktake-design.md.
"""
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from models.inventory_log import InventoryLog
from models.product import Product


def _key(suffix: str) -> str:
    """Idempotency keys must be 16-64 chars."""
    return f"stocktake-test-key-{suffix}"


def _log_count(db_session, product_id: int) -> int:
    return (
        db_session.query(InventoryLog)
        .filter(InventoryLog.product_id == product_id)
        .count()
    )


class TestStocktakeApplies:
    def test_counting_more_than_the_system_raises_stock(
        self, client: TestClient, db_session, admin_headers, test_product: Product
    ):
        before = _log_count(db_session, test_product.id)

        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("surplus")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "106",
                "expected_quantity": "100",
                "reason": "surplus",
                "note": "6 dona qutida topildi",
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert Decimal(body["previous_quantity"]) == Decimal("100")
        assert Decimal(body["new_quantity"]) == Decimal("106")
        assert Decimal(body["delta"]) == Decimal("6")

        db_session.refresh(test_product)
        assert test_product.stock_quantity == Decimal("106.000")
        assert _log_count(db_session, test_product.id) == before + 1

        log = (
            db_session.query(InventoryLog)
            .filter(InventoryLog.product_id == test_product.id)
            .order_by(InventoryLog.id.desc())
            .first()
        )
        assert log.reference_type == "surplus"
        assert log.quantity_change == Decimal("6.000")
        assert "6 dona qutida topildi" in log.reason

    def test_counting_less_than_the_system_lowers_stock_through_fifo(
        self, client: TestClient, db_session, admin_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("damage")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "88",
                "expected_quantity": "100",
                "reason": "shortage",
            },
        )

        assert response.status_code == 200, response.text
        assert Decimal(response.json()["delta"]) == Decimal("-12")

        db_session.refresh(test_product)
        assert test_product.stock_quantity == Decimal("88.000")
        # 88 units left at the fixture's 10.00 cost.
        assert test_product.inventory_value == Decimal("880.0000")

        log = (
            db_session.query(InventoryLog)
            .filter(InventoryLog.product_id == test_product.id)
            .order_by(InventoryLog.id.desc())
            .first()
        )
        assert log.reference_type == "shortage"
        assert log.quantity_change == Decimal("-12.000")

    def test_counting_to_zero_is_allowed(
        self, client: TestClient, db_session, admin_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("empty-shelf")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "0",
                "expected_quantity": "100",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 200, response.text
        db_session.refresh(test_product)
        assert test_product.stock_quantity == Decimal("0.000")


class TestStocktakeGuards:
    def test_stale_expected_quantity_is_rejected(
        self, client: TestClient, db_session, admin_headers, test_product: Product
    ):
        """The operator's page said 90; the shelf record says 100. Refuse."""
        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("stale-view")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "95",
                "expected_quantity": "90",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 409, response.text
        # The client needs the real figure to re-confirm against.
        assert "100" in response.text

        db_session.refresh(test_product)
        assert test_product.stock_quantity == Decimal("100.000")

    def test_counting_the_same_figure_writes_no_log(
        self, client: TestClient, db_session, admin_headers, test_product: Product
    ):
        """Confirming a correct figure is not a stock movement."""
        before = _log_count(db_session, test_product.id)

        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("no-change")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "100",
                "expected_quantity": "100",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 200, response.text
        assert Decimal(response.json()["delta"]) == Decimal("0")
        assert _log_count(db_session, test_product.id) == before

    def test_negative_counted_quantity_is_rejected(
        self, client: TestClient, admin_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("negative-count")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "-5",
                "expected_quantity": "100",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 422, response.text

    def test_unknown_reason_is_rejected(
        self, client: TestClient, admin_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("bad-reason")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "95",
                "expected_quantity": "100",
                "reason": "Корректировка остатка при редактировании товара",
            },
        )

        assert response.status_code == 422, response.text

    def test_missing_product_is_rejected(
        self, client: TestClient, admin_headers
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**admin_headers, "Idempotency-Key": _key("no-such-product")},
            json={
                "product_id": 999999,
                "counted_quantity": "1",
                "expected_quantity": "0",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 400, response.text


class TestStocktakeAccess:
    def test_cashier_cannot_count(
        self, client: TestClient, cashier_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**cashier_headers, "Idempotency-Key": _key("cashier")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "95",
                "expected_quantity": "100",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 403

    def test_manager_can_count(
        self, client: TestClient, db_session, manager_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers={**manager_headers, "Idempotency-Key": _key("manager")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "101",
                "expected_quantity": "100",
                "reason": "surplus",
            },
        )

        assert response.status_code == 200, response.text

    def test_anonymous_cannot_count(self, client: TestClient, test_product: Product):
        response = client.post(
            "/api/inventory/stocktake",
            headers={"Idempotency-Key": _key("anon")},
            json={
                "product_id": test_product.id,
                "counted_quantity": "95",
                "expected_quantity": "100",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 401

    def test_idempotency_key_is_required(
        self, client: TestClient, admin_headers, test_product: Product
    ):
        response = client.post(
            "/api/inventory/stocktake",
            headers=admin_headers,
            json={
                "product_id": test_product.id,
                "counted_quantity": "95",
                "expected_quantity": "100",
                "reason": "stocktake",
            },
        )

        assert response.status_code == 400

    def test_replaying_a_key_does_not_apply_twice(
        self, client: TestClient, db_session, admin_headers, test_product: Product
    ):
        payload = {
            "product_id": test_product.id,
            "counted_quantity": "97",
            "expected_quantity": "100",
            "reason": "shortage",
        }
        headers = {**admin_headers, "Idempotency-Key": _key("replayed-once")}

        first = client.post("/api/inventory/stocktake", headers=headers, json=payload)
        assert first.status_code == 200, first.text

        second = client.post("/api/inventory/stocktake", headers=headers, json=payload)
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        db_session.refresh(test_product)
        assert test_product.stock_quantity == Decimal("97.000")
