"""
Integration tests for Purchase Order workflow.
"""
import pytest
import uuid
from decimal import Decimal
from datetime import datetime
from fastapi.testclient import TestClient

from models.product import Product
from models.category import Category
from models.supplier import Supplier


def with_idempotency(headers: dict, key: str) -> dict:
    normalized_key = key if len(key) >= 16 else f"{key}-tenant-safe"
    return {**headers, "Idempotency-Key": normalized_key}


def _create_supplier(db_session, name=None):
    supplier = Supplier(
        name=name or f"Supplier {uuid.uuid4().hex[:8]}",
        phone=f"+12345{uuid.uuid4().hex[:6]}",
    )
    db_session.add(supplier)
    db_session.flush()
    return supplier


def _create_product(db_session, category):
    product = Product(
        name=f"Product {uuid.uuid4().hex[:8]}",
        barcode=f"BAR{uuid.uuid4().hex[:8]}",
        category_id=category.id,
        cost_price=Decimal("10.00"),
        sell_price=Decimal("20.00"),
        stock_quantity=0,
    )
    db_session.add(product)
    db_session.flush()
    return product


def _create_category(db_session):
    category = Category(name=f"Category {uuid.uuid4().hex[:8]}")
    db_session.add(category)
    db_session.flush()
    return category


class TestPurchaseOrderWorkflow:

    def test_create_po_draft(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
            "expected_delivery_date": "2026-06-01",
        }

        response = client.post("/api/purchase-orders", json=payload, headers=admin_headers)

        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "draft"
        assert len(data["items"]) == 1
        assert data["items"][0]["product_id"] == product.id
        assert data["items"][0]["quantity_ordered"] == "10.000"
        assert data["supplier"]["id"] == supplier.id

    def test_create_po_missing_supplier(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        payload = {
            "supplier_id": 99999,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }

        response = client.post("/api/purchase-orders", json=payload, headers=admin_headers)

        assert response.status_code == 400

    def test_send_po(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]

        send_headers = with_idempotency(admin_headers, f"send-po-key-{uuid.uuid4().hex}")

        response = client.post(
            f"/api/purchase-orders/{po_id}/send",
            json={},
            headers=send_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "sent"

    def test_send_po_without_idempotency_key_fails(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]

        response = client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=admin_headers)

        assert response.status_code == 400

    def test_receive_partial(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]
        po_item_id = create_resp.json()["items"][0]["id"]

        send_headers = with_idempotency(admin_headers, f"send-key-{uuid.uuid4().hex}")
        client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=send_headers)

        receive_payload = {
            "items": [
                {"item_id": po_item_id, "quantity_to_receive": "5"}
            ]
        }
        receive_headers = with_idempotency(admin_headers, f"receive-key-{uuid.uuid4().hex}")

        response = client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=receive_payload,
            headers=receive_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "partially_received"

        db_session.refresh(product)
        assert product.stock_quantity == 5

    def test_receive_rest(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]
        po_item_id = create_resp.json()["items"][0]["id"]

        send_headers = with_idempotency(admin_headers, f"send-{uuid.uuid4().hex}")
        client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=send_headers)

        receive_half_payload = {"items": [{"item_id": po_item_id, "quantity_to_receive": "5"}]}
        receive_half_headers = with_idempotency(admin_headers, f"recvhalf-{uuid.uuid4().hex}")
        recv_resp = client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=receive_half_payload,
            headers=receive_half_headers,
        )
        assert recv_resp.status_code == 200
        assert recv_resp.json()["status"] == "partially_received"

        receive_rest_payload = {"items": [{"item_id": po_item_id, "quantity_to_receive": "5"}]}
        receive_rest_headers = with_idempotency(admin_headers, f"recvrest-{uuid.uuid4().hex}")
        response = client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=receive_rest_payload,
            headers=receive_rest_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "received"

        db_session.refresh(product)
        assert product.stock_quantity == 10

    def test_receive_over_quantity_rejects(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]
        po_item_id = create_resp.json()["items"][0]["id"]

        send_headers = with_idempotency(admin_headers, f"send-{uuid.uuid4().hex}")
        client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=send_headers)

        over_payload = {"items": [{"item_id": po_item_id, "quantity_to_receive": "15"}]}
        over_headers = with_idempotency(admin_headers, f"over-{uuid.uuid4().hex}")

        response = client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=over_payload,
            headers=over_headers,
        )

        assert response.status_code == 400

    def test_receive_inventory_logs(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]
        po_item_id = create_resp.json()["items"][0]["id"]

        send_headers = with_idempotency(admin_headers, f"send-{uuid.uuid4().hex}")
        client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=send_headers)

        receive_payload = {"items": [{"item_id": po_item_id, "quantity_to_receive": "5"}]}
        receive_headers = with_idempotency(admin_headers, f"recv-{uuid.uuid4().hex}")
        client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=receive_payload,
            headers=receive_headers,
        )

        logs_response = client.get(
            f"/api/inventory/logs?product_id={product.id}",
            headers=admin_headers,
        )
        assert logs_response.status_code == 200
        logs = logs_response.json()
        assert len(logs) >= 1
        assert any(
            log["reference_type"] == "po_receive" and log["reference_id"] == po_id
            for log in logs
        )

    def test_receive_replay_idempotency(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]
        po_item_id = create_resp.json()["items"][0]["id"]

        send_headers = with_idempotency(admin_headers, f"send-{uuid.uuid4().hex}")
        client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=send_headers)

        replay_key = f"receive-replay-{uuid.uuid4().hex}"
        replay_headers = with_idempotency(admin_headers, replay_key)
        receive_payload = {"items": [{"item_id": po_item_id, "quantity_to_receive": "5"}]}

        response1 = client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=receive_payload,
            headers=replay_headers,
        )
        assert response1.status_code == 200

        db_session.refresh(product)
        stock_after_first = product.stock_quantity

        response2 = client.post(
            f"/api/purchase-orders/{po_id}/receive",
            json=receive_payload,
            headers=replay_headers,
        )
        assert response2.status_code == 200

        db_session.refresh(product)
        assert product.stock_quantity == stock_after_first
        assert response1.json()["status"] == response2.json()["status"]

    def test_cancel_po(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]

        cancel_headers = with_idempotency(admin_headers, f"cancel-{uuid.uuid4().hex}")
        response = client.post(
            f"/api/purchase-orders/{po_id}/cancel",
            json={},
            headers=cancel_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"

    def test_cancel_cancelled_po_fails(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]

        send_headers = with_idempotency(admin_headers, f"send-{uuid.uuid4().hex}")
        client.post(f"/api/purchase-orders/{po_id}/send", json={}, headers=send_headers)

        cancel_headers_1 = with_idempotency(admin_headers, f"cancel-1-{uuid.uuid4().hex}")
        cancel_resp = client.post(
            f"/api/purchase-orders/{po_id}/cancel",
            json={},
            headers=cancel_headers_1,
        )
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

        cancel_headers_2 = with_idempotency(admin_headers, f"cancel-2-{uuid.uuid4().hex}")
        response = client.post(
            f"/api/purchase-orders/{po_id}/cancel",
            json={},
            headers=cancel_headers_2,
        )

        assert response.status_code == 409

    def test_send_replay_idempotency(self, client: TestClient, db_session, admin_headers):
        category = _create_category(db_session)
        supplier = _create_supplier(db_session)
        product = _create_product(db_session, category)
        db_session.commit()

        create_payload = {
            "supplier_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity_ordered": "10",
                    "unit_cost": "15.00",
                }
            ],
        }
        create_resp = client.post("/api/purchase-orders", json=create_payload, headers=admin_headers)
        po_id = create_resp.json()["id"]

        replay_key = f"send-replay-{uuid.uuid4().hex}"
        replay_headers = with_idempotency(admin_headers, replay_key)

        response1 = client.post(
            f"/api/purchase-orders/{po_id}/send",
            json={},
            headers=replay_headers,
        )
        assert response1.status_code == 200
        assert response1.json()["status"] == "sent"

        response2 = client.post(
            f"/api/purchase-orders/{po_id}/send",
            json={},
            headers=replay_headers,
        )
        assert response2.status_code == 200
        assert response2.json()["status"] == "sent"
