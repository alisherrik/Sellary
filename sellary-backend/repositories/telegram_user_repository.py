from typing import Optional

from sqlalchemy.orm import Session

from models.telegram_user import TelegramUser


class TelegramUserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_telegram_id(self, telegram_id: int) -> Optional[TelegramUser]:
        return (
            self.db.query(TelegramUser)
            .filter(TelegramUser.telegram_id == telegram_id)
            .first()
        )

    def get_or_create(
        self,
        telegram_id: int,
        *,
        first_name: str | None = None,
        username: str | None = None,
    ) -> TelegramUser:
        user = self.get_by_telegram_id(telegram_id)
        if user is None:
            user = TelegramUser(
                telegram_id=telegram_id,
                first_name=first_name,
                username=username,
            )
            self.db.add(user)
            self.db.flush()
            return user
        # Keep the identity fresh (Telegram profile can change).
        changed = False
        if first_name is not None and user.first_name != first_name:
            user.first_name = first_name
            changed = True
        if username is not None and user.username != username:
            user.username = username
            changed = True
        if changed:
            self.db.flush()
        return user
