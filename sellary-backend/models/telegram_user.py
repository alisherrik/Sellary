from sqlalchemy import BigInteger, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from core.database import Base


class TelegramUser(Base):
    """Global, login-less shopper identity, keyed by a verified Telegram id.

    Created on the shopper's first authenticated request via get-or-create.
    ``phone`` is captured later (shared on first order); browsing needs none.
    """

    __tablename__ = "telegram_users"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, index=True, nullable=False)
    first_name = Column(String(150), nullable=True)
    username = Column(String(150), nullable=True)
    phone = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
