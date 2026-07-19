"""Integration tests for MerchantNotifyService (F6)."""
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from core.config import settings
from models.order import Order, FulfillmentType, OrderStatus
from models.order_item import OrderItem
from repositories.merchant_notify_repository import MerchantNotifyRepository
from services.merchant_link_token import mint_company_ref
from services.merchant_notify_service import MerchantNotifyService


class _FakeBot:
    def __init__(self):
        self.sent = []

    def send_message(self, chat_id, text):
        self.sent.append((chat_id, text))


class _BoomBot:
    def send_message(self, chat_id, text):
        raise RuntimeError("telegram down")


@pytest.fixture
def make_order(db_session):
    """Build a persisted Order + one OrderItem under the given company."""

    def _make(company_id):
        order = Order(
            company_id=company_id,
            telegram_user_id=1,
            order_number=9001,
            status=OrderStatus.PENDING.value,
            fulfillment_type=FulfillmentType.PICKUP.value,
            contact_phone="+998901234567",
            contact_name="Test Buyer",
            subtotal=Decimal("200.00"),
            total_amount=Decimal("200.00"),
        )
        db_session.add(order)
        db_session.flush()

        item = OrderItem(
            order_id=order.id,
            product_name="Widget",
            unit_price=Decimal("100.0000"),
            quantity=Decimal("2.000"),
            line_total=Decimal("200.00"),
        )
        db_session.add(item)
        db_session.flush()
        db_session.refresh(order)
        return order

    return _make


def test_link_from_valid_payload(db_session, default_company):
    svc = MerchantNotifyService(db_session, bot_client=_FakeBot())
    payload = mint_company_ref(default_company.id, secret=settings.SECRET_KEY)
    assert svc.link_from_start_payload(payload, "12345") is True
    db_session.flush()
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == ["12345"]


def test_link_from_invalid_payload_is_ignored(db_session, default_company):
    svc = MerchantNotifyService(db_session, bot_client=_FakeBot())
    assert svc.link_from_start_payload("forged-token", "12345") is False
    db_session.flush()
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == []


def test_notify_sends_to_all_links(db_session, default_company, make_order):
    MerchantNotifyRepository(db_session).upsert(default_company.id, "111")
    MerchantNotifyRepository(db_session).upsert(default_company.id, "222")
    db_session.flush()
    bot = _FakeBot()
    order = make_order(company_id=default_company.id)
    MerchantNotifyService(db_session, bot_client=bot).notify_new_order(order)
    assert {c for c, _ in bot.sent} == {"111", "222"}
    body = bot.sent[0][1]
    assert str(order.order_number) in body


def test_notify_swallows_send_failure(db_session, default_company, make_order):
    MerchantNotifyRepository(db_session).upsert(default_company.id, "111")
    db_session.flush()
    order = make_order(company_id=default_company.id)
    # Must NOT raise even though the bot always throws.
    MerchantNotifyService(db_session, bot_client=_BoomBot()).notify_new_order(order)


def test_notify_noop_when_no_links(db_session, default_company, make_order):
    bot = _FakeBot()
    order = make_order(company_id=default_company.id)
    MerchantNotifyService(db_session, bot_client=bot).notify_new_order(order)
    assert bot.sent == []


def test_format_message_contains_key_fields(db_session, default_company, make_order):
    order = make_order(company_id=default_company.id)
    msg = MerchantNotifyService.format_order_message(order)
    assert str(order.order_number) in msg
    assert order.contact_name in msg
