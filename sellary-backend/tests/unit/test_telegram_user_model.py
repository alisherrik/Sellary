"""TelegramUser persists a global shopper identity; Customer gains telegram_id."""
from decimal import Decimal

import pytest

from models.customer import Customer
from models.telegram_user import TelegramUser


def test_telegram_user_defaults(db_session):
    tu = TelegramUser(telegram_id=123456789, first_name="Ali", username="ali")
    db_session.add(tu)
    db_session.flush()
    assert tu.id is not None
    assert tu.phone is None
    assert tu.created_at is not None


def test_telegram_id_is_unique(db_session):
    db_session.add(TelegramUser(telegram_id=555, first_name="A"))
    db_session.flush()
    db_session.add(TelegramUser(telegram_id=555, first_name="B"))
    with pytest.raises(Exception):
        db_session.flush()


def test_customer_has_nullable_telegram_id(db_session, default_company):
    customer = Customer(company_id=default_company.id, name="Web Cust")
    db_session.add(customer)
    db_session.flush()
    assert customer.telegram_id is None
    customer.telegram_id = 987654321
    db_session.flush()
    assert customer.telegram_id == 987654321
