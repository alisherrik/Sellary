"""Shopper-facing order endpoints — POST /api/shop/orders, GET /api/shop/orders.

Tests:
  - POST /api/shop/orders: creates orders, requires Idempotency-Key, replays on retry
  - GET  /api/shop/orders: returns shopper's orders
  - GET  /api/shop/orders/{id}: returns single order (own only)
  - Idempotency key replay returns same response
  - Idempotency scoping: company_id = min(company_ids), user_id = telegram_users.id
"""
import hashlib
import hmac
import json
from decimal import Decimal
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from models.inventory_layer import InventoryLayer
from models.product import Product
from models.telegram_user import TelegramUser

BOT_TOKEN = "123456:SHOP-ORDER-TEST"


def _sign(telegram_id=42, auth_date=1_700_000_000, bot_token=BOT_TOKEN):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": "ali"},
        separators=(",", ":"),
    )
    fields = {"auth_date": str(auth_date), "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture(autouse=True)
def patch_bot_token(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10 ** 12)


def _shopper_headers(telegram_id=42):
    return {"X-Telegram-Init-Data": _sign(telegram_id=telegram_id)}


def _make_published_product(db, company, stock=10, price="200.00"):
    # Ensure marketplace is enabled so place_orders() gateway passes.
    company.is_marketplace_enabled = True
    db.flush()
    p = Product(
        company_id=company.id,
        name="ShopOrderItem",
        cost_price=Decimal("80.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal(str(stock)),
        is_active=True,
        is_published=True,
    )
    db.add(p)
    db.flush()
    if stock > 0:
        layer = InventoryLayer(
            company_id=company.id,
            product_id=p.id,
            source_type="opening_balance",
            source_id=None,
            original_quantity=Decimal(str(stock)),
            remaining_quantity=Decimal(str(stock)),
            unit_cost=Decimal("80.0000"),
        )
        db.add(layer)
        p.inventory_value = (Decimal(str(stock)) * Decimal("80.0000")).quantize(
            Decimal("0.0001")
        )
        db.flush()
    return p


def _checkout_payload(company_id, product_id, qty=1, group_id="grp-001"):
    return {
        "orders": [
            {
                "company_id": company_id,
                "items": [
                    {
                        "product_id": product_id,
                        "quantity": str(qty),
                        "unit_price": "200.0000",
                    }
                ],
                "fulfillment_type": "pickup",
                "contact_phone": "+99890000000",
                "contact_name": "Ali",
                "checkout_group_id": group_id,
            }
        ]
    }


# ---------------------------------------------------------------------------
# Tests: POST /api/shop/orders
# ---------------------------------------------------------------------------

def test_place_order_creates_orders(
    client: TestClient, db_session, default_company
):
    p = _make_published_product(db_session, default_company)
    payload = _checkout_payload(default_company.id, p.id)

    resp = client.post(
        "/api/shop/orders",
        json=payload,
        headers={
            **_shopper_headers(telegram_id=7001),
            "Idempotency-Key": "unique-key-shop-001" + "x" * 5,
        },
    )
    assert resp.status_code == 201, resp.text
    orders = resp.json()
    assert len(orders) == 1
    assert orders[0]["status"] == "pending"
    assert orders[0]["company_id"] == default_company.id


def test_place_order_requires_idempotency_key(
    client: TestClient, db_session, default_company
):
    p = _make_published_product(db_session, default_company)
    payload = _checkout_payload(default_company.id, p.id)

    resp = client.post(
        "/api/shop/orders",
        json=payload,
        headers=_shopper_headers(telegram_id=7002),
    )
    assert resp.status_code == 422  # Missing required header → FastAPI 422


def test_place_order_idempotency_replay(
    client: TestClient, db_session, default_company
):
    """Second call with same Idempotency-Key returns same response without duplicating."""
    p = _make_published_product(db_session, default_company, stock=100)
    payload = _checkout_payload(default_company.id, p.id, group_id="grp-replay")

    ikey = "idempotent-replay-key12345"
    headers = {**_shopper_headers(telegram_id=7003), "Idempotency-Key": ikey}

    r1 = client.post("/api/shop/orders", json=payload, headers=headers)
    assert r1.status_code == 201, r1.text
    r2 = client.post("/api/shop/orders", json=payload, headers=headers)
    assert r2.status_code == 201, r2.text

    # Both responses should refer to the same order IDs.
    ids1 = {o["id"] for o in r1.json()}
    ids2 = {o["id"] for o in r2.json()}
    assert ids1 == ids2


def test_place_order_idempotency_conflict_returns_409(
    client: TestClient, db_session, default_company
):
    """Same Idempotency-Key with a DIFFERENT cart body must return 409, not a silent replay."""
    p = _make_published_product(db_session, default_company, stock=100)
    payload_a = _checkout_payload(default_company.id, p.id, qty=1, group_id="grp-conflict-a")
    payload_b = _checkout_payload(default_company.id, p.id, qty=2, group_id="grp-conflict-b")

    ikey = "conflict-test-key-1234567"
    headers = {**_shopper_headers(telegram_id=7010), "Idempotency-Key": ikey}

    r1 = client.post("/api/shop/orders", json=payload_a, headers=headers)
    assert r1.status_code == 201, r1.text

    # Second call with same key but different body → 409
    r2 = client.post("/api/shop/orders", json=payload_b, headers=headers)
    assert r2.status_code == 409, r2.text


def test_place_order_requires_init_data(client: TestClient, db_session, default_company):
    p = _make_published_product(db_session, default_company)
    payload = _checkout_payload(default_company.id, p.id)

    resp = client.post(
        "/api/shop/orders",
        json=payload,
        headers={"Idempotency-Key": "no-auth-key-1234567"},
    )
    assert resp.status_code in (401, 422)


def test_place_order_rejects_unpublished_product(
    client: TestClient, db_session, default_company
):
    # Enable marketplace so the company gate passes and product gate fires.
    default_company.is_marketplace_enabled = True
    db_session.flush()
    p = Product(
        company_id=default_company.id,
        name="Hidden",
        cost_price=Decimal("1.00"),
        sell_price=Decimal("2.00"),
        stock_quantity=Decimal("5"),
        is_active=True,
        is_published=False,
    )
    db_session.add(p)
    db_session.flush()

    payload = _checkout_payload(default_company.id, p.id)
    resp = client.post(
        "/api/shop/orders",
        json=payload,
        headers={
            **_shopper_headers(telegram_id=7004),
            "Idempotency-Key": "hidden-prod-test-key-1",
        },
    )
    assert resp.status_code == 422, resp.text


def test_place_order_rejects_marketplace_disabled_company(
    client: TestClient, db_session, default_company
):
    """Fix 2: ordering from a marketplace-disabled company must be rejected (422)."""
    # default_company.is_marketplace_enabled is False by default — do NOT enable it.
    p = Product(
        company_id=default_company.id,
        name="DisabledShop",
        cost_price=Decimal("5.00"),
        sell_price=Decimal("10.00"),
        stock_quantity=Decimal("5"),
        is_active=True,
        is_published=True,
    )
    db_session.add(p)
    db_session.flush()

    payload = _checkout_payload(default_company.id, p.id)
    resp = client.post(
        "/api/shop/orders",
        json=payload,
        headers={
            **_shopper_headers(telegram_id=7005),
            "Idempotency-Key": "disabled-company-key-12345",
        },
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Tests: GET /api/shop/orders
# ---------------------------------------------------------------------------

def test_list_my_orders_returns_shopper_orders(
    client: TestClient, db_session, default_company
):
    p = _make_published_product(db_session, default_company, stock=50)

    # Place orders as shopper A
    headers_a = {**_shopper_headers(telegram_id=8001), "Idempotency-Key": "shopper-a-list-key-1"}
    r1 = client.post(
        "/api/shop/orders",
        json=_checkout_payload(default_company.id, p.id, group_id="grp-a"),
        headers=headers_a,
    )
    assert r1.status_code == 201

    # Shopper A's "my orders" should include it
    list_resp = client.get("/api/shop/orders", headers=_shopper_headers(telegram_id=8001))
    assert list_resp.status_code == 200
    body = list_resp.json()
    assert body["total"] >= 1
    ids = [o["id"] for o in body["items"]]
    assert r1.json()[0]["id"] in ids


def test_get_my_order_returns_own_order(
    client: TestClient, db_session, default_company
):
    p = _make_published_product(db_session, default_company, stock=50)
    r = client.post(
        "/api/shop/orders",
        json=_checkout_payload(default_company.id, p.id, group_id="grp-detail"),
        headers={**_shopper_headers(telegram_id=8002), "Idempotency-Key": "detail-order-key-12345"},
    )
    assert r.status_code == 201
    order_id = r.json()[0]["id"]

    detail = client.get(f"/api/shop/orders/{order_id}", headers=_shopper_headers(telegram_id=8002))
    assert detail.status_code == 200
    assert detail.json()["id"] == order_id


def test_get_my_order_hides_other_shoppers_orders(
    client: TestClient, db_session, default_company
):
    p = _make_published_product(db_session, default_company, stock=50)
    # Shopper A places order
    r = client.post(
        "/api/shop/orders",
        json=_checkout_payload(default_company.id, p.id, group_id="grp-priv"),
        headers={**_shopper_headers(telegram_id=9001), "Idempotency-Key": "privacy-order-key-12345"},
    )
    assert r.status_code == 201
    order_id = r.json()[0]["id"]

    # Shopper B tries to read it → 404
    resp = client.get(f"/api/shop/orders/{order_id}", headers=_shopper_headers(telegram_id=9002))
    assert resp.status_code == 404
