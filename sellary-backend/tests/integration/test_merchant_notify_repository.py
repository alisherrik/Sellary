from repositories.merchant_notify_repository import MerchantNotifyRepository


def test_upsert_creates_then_is_idempotent(db_session, default_company):
    repo = MerchantNotifyRepository(db_session)
    a = repo.upsert(default_company.id, "555")
    db_session.flush()
    b = repo.upsert(default_company.id, "555")   # same pair → no duplicate
    db_session.flush()
    assert a.id == b.id
    assert repo.list_chat_ids_for_company(default_company.id) == ["555"]


def test_lists_multiple_chats(db_session, default_company):
    repo = MerchantNotifyRepository(db_session)
    repo.upsert(default_company.id, "111")
    repo.upsert(default_company.id, "222")
    db_session.flush()
    assert set(repo.list_chat_ids_for_company(default_company.id)) == {"111", "222"}


def test_empty_for_unlinked_company(db_session, default_company):
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == []
