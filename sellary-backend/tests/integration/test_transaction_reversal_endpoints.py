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
