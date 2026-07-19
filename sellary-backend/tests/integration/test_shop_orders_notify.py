"""Task 8 — wire notification into POST /api/shop/orders (F6).

Verifies:
  - A notify payload is gathered per created order (chat_ids + message),
    and the deferred send receives the correct data.
  - A notify exception does NOT fail the 201 response.
  - The deferred background task (_send_notify) is DB-free: it receives a
    plain _NotifyPayload built while the request session was open (Fix 1).

Reuses the F4 fixture/helper pattern from test_shop_order_endpoints.py.
"""
import hashlib
import hmac
import json
import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from models.inventory_layer import InventoryLayer
from models.product import Product
from repositories.merchant_notify_repository import MerchantNotifyRepository

BOT_TOKEN = "123456:NOTIFY-TEST"


def _sign(telegram_id=99, auth_date=1_700_000_000, bot_token=BOT_TOKEN):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Buyer", "username": "buyer"},
        separators=(",", ":"),
    )
    fields = {"auth_date": str(auth_date), "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    from urllib.parse import urlencode
    return urlencode(fields)


@pytest.fixture(autouse=True)
def patch_bot_token(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10 ** 12)


@pytest.fixture
def marketplace_company(db_session, default_company):
    default_company.is_marketplace_enabled = True
    db_session.flush()
    return default_company


@pytest.fixture
def published_product(db_session, marketplace_company):
    p = Product(
        company_id=marketplace_company.id,
        name="NotifyTestProduct",
        cost_price=Decimal("50.0000"),
        sell_price=Decimal("100.0000"),
        stock_quantity=Decimal("10"),
        is_active=True,
        is_published=True,
    )
    db_session.add(p)
    db_session.flush()
    layer = InventoryLayer(
        company_id=marketplace_company.id,
        product_id=p.id,
        source_type="opening_balance",
        source_id=None,
        original_quantity=Decimal("10"),
        remaining_quantity=Decimal("10"),
        unit_cost=Decimal("50.0000"),
    )
    db_session.add(layer)
    p.inventory_value = (Decimal("10") * Decimal("50.0000")).quantize(Decimal("0.0001"))
    db_session.flush()
    return p


@pytest.fixture
def checkout_body(marketplace_company, published_product):
    return {
        "orders": [
            {
                "company_id": marketplace_company.id,
                "items": [
                    {
                        "product_id": published_product.id,
                        "quantity": "1",
                        "unit_price": "100.0000",
                    }
                ],
                "fulfillment_type": "pickup",
                "contact_phone": "+998901234567",
                "contact_name": "Test Buyer",
                "checkout_group_id": str(uuid.uuid4()),
            }
        ]
    }


@pytest.fixture
def idem_headers():
    key = "notify-test-idem-key-" + uuid.uuid4().hex[:12]
    return {
        "X-Telegram-Init-Data": _sign(telegram_id=88888),
        "Idempotency-Key": key,
    }


def test_placing_order_notifies_linked_merchant(
    client: TestClient, db_session, marketplace_company, checkout_body, idem_headers
):
    """Fix 1 regression test: gather is inline (DB), send is deferred (network-only).

    Patches _send_notify (the deferred background task) and asserts it receives a
    _NotifyPayload with the correct company_id and a non-empty chat_ids list.
    The DB gather (build_notify_payload) runs for real on the test session — this
    proves the inline path works while the session is open.
    """
    MerchantNotifyRepository(db_session).upsert(marketplace_company.id, "42042")
    db_session.flush()

    sent_payloads = []

    def fake_send_notify(payload):
        sent_payloads.append(payload)

    with patch("api.shop_orders._send_notify", fake_send_notify):
        resp = client.post("/api/shop/orders", json=checkout_body, headers=idem_headers)

    assert resp.status_code == 201, resp.text
    assert len(sent_payloads) == 1
    payload = sent_payloads[0]
    assert payload.company_id == marketplace_company.id
    assert "42042" in payload.chat_ids
    assert payload.message  # non-empty message string


def test_notify_failure_does_not_fail_order(
    client: TestClient, db_session, marketplace_company, checkout_body, idem_headers
):
    """Best-effort guarantee: even if the Telegram bot send raises, the order is still 201.

    Patches TelegramBotClient.send_message to raise inside _send_notify — the
    per-chat try/except inside _send_notify swallows it, so the 201 is returned.
    """
    MerchantNotifyRepository(db_session).upsert(marketplace_company.id, "42042")
    db_session.flush()

    def boom(self, chat_id, text):
        raise RuntimeError("telegram exploded")

    # _send_notify creates its own TelegramBotClient and iterates chats;
    # patching send_message exercises the inner per-chat swallow guarantee.
    with patch("services.telegram_bot_client.TelegramBotClient.send_message", boom):
        resp = client.post("/api/shop/orders", json=checkout_body, headers=idem_headers)

    assert resp.status_code == 201, resp.text
    assert len(resp.json()) >= 1  # orders were still created & returned


def test_no_notify_when_no_links(
    client: TestClient, db_session, marketplace_company, checkout_body, idem_headers
):
    """No background task is scheduled when no chat_ids are linked."""
    # Do NOT upsert any chat link for this company.

    sent_payloads = []

    def fake_send_notify(payload):
        sent_payloads.append(payload)

    with patch("api.shop_orders._send_notify", fake_send_notify):
        resp = client.post("/api/shop/orders", json=checkout_body, headers=idem_headers)

    assert resp.status_code == 201, resp.text
    assert sent_payloads == []  # no send scheduled when no linked chats


def test_notify_gather_failure_does_not_fail_order(
    client: TestClient, db_session, marketplace_company, checkout_body, idem_headers
):
    """Even if build_notify_payload raises, the order response is still 201."""
    MerchantNotifyRepository(db_session).upsert(marketplace_company.id, "42042")
    db_session.flush()

    def boom(order_id):
        raise RuntimeError("DB gather exploded")

    with patch(
        "services.merchant_notify_service.MerchantNotifyService.build_notify_payload", boom
    ):
        resp = client.post("/api/shop/orders", json=checkout_body, headers=idem_headers)

    assert resp.status_code == 201, resp.text
    assert len(resp.json()) >= 1
