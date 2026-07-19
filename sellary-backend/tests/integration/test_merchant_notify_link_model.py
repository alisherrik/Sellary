import pytest
from sqlalchemy.exc import IntegrityError
from models.merchant_notify_link import MerchantNotifyLink


def test_can_create_link(db_session, default_company):
    link = MerchantNotifyLink(company_id=default_company.id, telegram_chat_id="123456")
    db_session.add(link)
    db_session.flush()          # NOT commit — rollback isolation
    assert link.id is not None
    assert link.created_at is not None


def test_unique_company_chat(db_session, default_company):
    db_session.add(MerchantNotifyLink(company_id=default_company.id, telegram_chat_id="777"))
    db_session.flush()
    db_session.add(MerchantNotifyLink(company_id=default_company.id, telegram_chat_id="777"))
    with pytest.raises(IntegrityError):
        db_session.flush()
