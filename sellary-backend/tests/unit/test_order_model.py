"""Order and OrderItem model defaults and constraints."""
from decimal import Decimal

import pytest

from models.order import FulfillmentType, Order, OrderStatus
from models.order_item import OrderItem


def test_order_status_enum_values():
    assert OrderStatus.PENDING.value == "pending"
    assert OrderStatus.CONFIRMED.value == "confirmed"
    assert OrderStatus.CANCELLED.value == "cancelled"
    assert OrderStatus.COMPLETED.value == "completed"


def test_fulfillment_type_enum_values():
    assert FulfillmentType.DELIVERY.value == "delivery"
    assert FulfillmentType.PICKUP.value == "pickup"


def test_order_defaults(db_session, default_company):
    from models.telegram_user import TelegramUser

    tu = TelegramUser(telegram_id=111, first_name="Test")
    db_session.add(tu)
    db_session.flush()

    order = Order(
        company_id=default_company.id,
        telegram_user_id=tu.id,
        order_number=1,
        status=OrderStatus.PENDING.value,
        fulfillment_type=FulfillmentType.PICKUP.value,
        contact_phone="+99890000000",
        contact_name="Ali",
        subtotal=Decimal("1000.00"),
        total_amount=Decimal("1000.00"),
    )
    db_session.add(order)
    db_session.flush()

    assert order.id is not None
    assert order.status == "pending"
    assert order.sale_id is None
    assert order.delivery_address is None
    assert order.checkout_group_id is None
    assert order.created_at is not None
    assert order.updated_at is not None


def test_order_item_snapshot(db_session, default_company, test_product):
    from models.telegram_user import TelegramUser

    tu = TelegramUser(telegram_id=222, first_name="Bob")
    db_session.add(tu)
    db_session.flush()

    order = Order(
        company_id=default_company.id,
        telegram_user_id=tu.id,
        order_number=2,
        status=OrderStatus.PENDING.value,
        fulfillment_type=FulfillmentType.DELIVERY.value,
        delivery_address="Street 1",
        contact_phone="+99890000001",
        contact_name="Bob",
        subtotal=Decimal("30.00"),
        total_amount=Decimal("30.00"),
    )
    db_session.add(order)
    db_session.flush()

    item = OrderItem(
        order_id=order.id,
        product_id=test_product.id,
        product_name="Snapshotted Name",
        unit_price=Decimal("15.0000"),
        quantity=Decimal("2.000"),
        line_total=Decimal("30.00"),
    )
    db_session.add(item)
    db_session.flush()

    assert item.id is not None
    assert item.product_name == "Snapshotted Name"
    assert item.unit_price == Decimal("15.0000")
