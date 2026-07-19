"""TelegramUserRepository.get_or_create is idempotent per telegram_id."""
from repositories.telegram_user_repository import TelegramUserRepository


def test_creates_on_first_sight(db_session):
    repo = TelegramUserRepository(db_session)
    user = repo.get_or_create(777, first_name="Ali", username="ali")
    db_session.flush()
    assert user.id is not None
    assert user.telegram_id == 777


def test_returns_existing_and_updates_name(db_session):
    repo = TelegramUserRepository(db_session)
    first = repo.get_or_create(888, first_name="Old", username="old")
    db_session.flush()
    again = repo.get_or_create(888, first_name="New", username="new")
    db_session.flush()
    assert again.id == first.id
    assert again.first_name == "New"
    assert again.username == "new"
