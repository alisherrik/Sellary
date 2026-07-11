"""Integration tests for admin sale annulment (void) endpoints."""
import pytest
from decimal import Decimal


@pytest.mark.parametrize("headers_fixture", ["manager_headers", "cashier_headers"])
def test_sale_void_requires_admin(client, request, test_sale, headers_fixture):
    headers = {**request.getfixturevalue(headers_fixture), "Idempotency-Key": "sale-void-forbid-01"}
    response = client.post(
        f"/api/sales/{test_sale.id}/void", json={"reason": "Тест"}, headers=headers
    )
    assert response.status_code == 403


def test_sale_void_is_idempotent(client, test_sale, admin_headers):
    headers = {**admin_headers, "Idempotency-Key": "sale-void-idempotent-01"}
    first = client.post(
        f"/api/sales/{test_sale.id}/void", json={"reason": "Тестовая продажа"}, headers=headers
    )
    second = client.post(
        f"/api/sales/{test_sale.id}/void", json={"reason": "Тестовая продажа"}, headers=headers
    )
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()


def test_sale_void_success_returns_result(client, db_session, test_sale, admin_headers):
    headers = {**admin_headers, "Idempotency-Key": "sale-void-success-01"}
    response = client.post(
        f"/api/sales/{test_sale.id}/void", json={"reason": "Брак товара"}, headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["entity_type"] == "sale"
    assert data["entity_id"] == test_sale.id
    assert data["status"] == "cancelled"
    assert data["operation_id"] is not None
    assert data["voided_at"] is not None

    db_session.refresh(test_sale)
    assert str(test_sale.status.value) == "cancelled"
    assert test_sale.void_reason == "Брак товара"


def test_sale_void_rejects_short_reason(client, test_sale, admin_headers):
    headers = {**admin_headers, "Idempotency-Key": "sale-void-short-reason-01"}
    response = client.post(
        f"/api/sales/{test_sale.id}/void", json={"reason": "x"}, headers=headers
    )
    assert response.status_code == 422


def test_sale_void_requires_idempotency_key(client, test_sale, admin_headers):
    response = client.post(
        f"/api/sales/{test_sale.id}/void", json={"reason": "Без ключа"}, headers=admin_headers
    )
    assert response.status_code == 400


def test_sale_void_already_voided_conflicts(client, db_session, test_sale, admin_headers):
    first = client.post(
        f"/api/sales/{test_sale.id}/void",
        json={"reason": "Первое"},
        headers={**admin_headers, "Idempotency-Key": "sale-void-conflict-first-01"},
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/sales/{test_sale.id}/void",
        json={"reason": "Второе"},
        headers={**admin_headers, "Idempotency-Key": "sale-void-conflict-second-01"},
    )
    assert second.status_code == 409


class TestVoidPreviewEndpoint:
    @pytest.mark.parametrize("headers_fixture", ["manager_headers", "cashier_headers"])
    def test_void_preview_requires_admin(self, client, request, test_sale, headers_fixture):
        headers = request.getfixturevalue(headers_fixture)
        response = client.get(f"/api/sales/{test_sale.id}/void-preview", headers=headers)
        assert response.status_code == 403

    def test_void_preview_returns_impacts(self, client, test_sale, admin_headers):
        response = client.get(f"/api/sales/{test_sale.id}/void-preview", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["can_void"] is True
        assert data["blockers"] == []
        assert len(data["impacts"]) == 1
        assert data["impacts"][0]["product_id"] == test_sale.items[0].product_id
        assert Decimal(data["impacts"][0]["quantity_change"]) == Decimal("2")


class TestPurchaseVoidEndpoints:
    def test_purchase_void_requires_admin(self, client, partially_received_po, manager_headers):
        response = client.post(
            f"/api/purchase-orders/{partially_received_po.id}/void",
            json={"reason": "Тестовая закупка"},
            headers={**manager_headers, "Idempotency-Key": "purchase-void-forbid-01"},
        )
        assert response.status_code == 403

    def test_purchase_void_preview_and_execute(
        self, client, db_session, partially_received_po, admin_headers
    ):
        preview = client.get(
            f"/api/purchase-orders/{partially_received_po.id}/void-preview",
            headers=admin_headers,
        )
        assert preview.status_code == 200
        assert preview.json()["can_void"] is True

        response = client.post(
            f"/api/purchase-orders/{partially_received_po.id}/void",
            json={"reason": "Тестовая закупка"},
            headers={**admin_headers, "Idempotency-Key": "purchase-void-success-01"},
        )
        assert response.status_code == 200
        assert response.json()["entity_type"] == "purchase_order"
        db_session.refresh(partially_received_po)
        assert partially_received_po.status.value == "cancelled"
        assert partially_received_po.void_reason == "Тестовая закупка"


class TestPurchaseItemVoidEndpoints:
    def _url(self, po_id, item_id, action):
        return f"/api/purchase-orders/{po_id}/items/{item_id}/{action}"

    @pytest.mark.parametrize("headers_fixture", ["manager_headers", "cashier_headers"])
    def test_item_void_requires_admin(
        self, client, request, multi_line_received_po, headers_fixture
    ):
        po = multi_line_received_po
        headers = {
            **request.getfixturevalue(headers_fixture),
            "Idempotency-Key": "po-item-void-forbid-0001",
        }
        response = client.post(
            self._url(po.id, po.items[0].id, "void"),
            json={"reason": "Тест"},
            headers=headers,
        )
        assert response.status_code == 403

    def test_item_void_preview_requires_admin(
        self, client, multi_line_received_po, manager_headers
    ):
        po = multi_line_received_po
        response = client.get(
            self._url(po.id, po.items[0].id, "void-preview"), headers=manager_headers
        )
        assert response.status_code == 403

    def test_item_void_preview_and_execute(
        self, client, db_session, multi_line_received_po, admin_headers
    ):
        po = multi_line_received_po
        line0, line1 = po.items[0], po.items[1]

        preview = client.get(
            self._url(po.id, line0.id, "void-preview"), headers=admin_headers
        )
        assert preview.status_code == 200
        body = preview.json()
        assert body["can_void"] is True
        assert len(body["impacts"]) == 1

        response = client.post(
            self._url(po.id, line0.id, "void"),
            json={"reason": "Ошибочная позиция"},
            headers={**admin_headers, "Idempotency-Key": "po-item-void-success-0001"},
        )
        assert response.status_code == 200
        assert response.json()["entity_type"] == "purchase_order"

        db_session.refresh(line0)
        db_session.refresh(line1)
        assert line0.voided_at is not None
        assert line0.void_reason == "Ошибочная позиция"
        assert line1.voided_at is None

    def test_item_void_is_idempotent(
        self, client, multi_line_received_po, admin_headers
    ):
        po = multi_line_received_po
        headers = {**admin_headers, "Idempotency-Key": "po-item-void-idem-0001"}
        first = client.post(
            self._url(po.id, po.items[0].id, "void"),
            json={"reason": "Идемпотентность"},
            headers=headers,
        )
        second = client.post(
            self._url(po.id, po.items[0].id, "void"),
            json={"reason": "Идемпотентность"},
            headers=headers,
        )
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()

    def test_item_void_requires_idempotency_key(
        self, client, multi_line_received_po, admin_headers
    ):
        po = multi_line_received_po
        response = client.post(
            self._url(po.id, po.items[0].id, "void"),
            json={"reason": "Без ключа"},
            headers=admin_headers,
        )
        assert response.status_code == 400

    def test_item_void_second_attempt_conflicts(
        self, client, multi_line_received_po, admin_headers
    ):
        po = multi_line_received_po
        first = client.post(
            self._url(po.id, po.items[0].id, "void"),
            json={"reason": "Первое"},
            headers={**admin_headers, "Idempotency-Key": "po-item-void-conflict-a01"},
        )
        assert first.status_code == 200
        second = client.post(
            self._url(po.id, po.items[0].id, "void"),
            json={"reason": "Второе"},
            headers={**admin_headers, "Idempotency-Key": "po-item-void-conflict-b01"},
        )
        assert second.status_code == 409

    def test_item_void_cross_tenant_not_found(
        self, client, db_session, multi_line_received_po, admin_headers
    ):
        """An item id belonging to a different purchase order is rejected as
        not-found (the item must belong to the route's parent document)."""
        po = multi_line_received_po
        response = client.post(
            self._url(po.id, 999999, "void"),
            json={"reason": "Чужая позиция"},
            headers={**admin_headers, "Idempotency-Key": "po-item-void-foreign-001"},
        )
        assert response.status_code == 404
