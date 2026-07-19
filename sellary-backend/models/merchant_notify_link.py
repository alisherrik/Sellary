"""Telegram chats to notify per shop (F6 new-order notifications).

A merchant links their chat once via the bot's /start deep-link; each new online
order fires a best-effort message to every linked chat for that company.
"""
from sqlalchemy import Column, ForeignKey, Index, Integer, String, UniqueConstraint, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class MerchantNotifyLink(Base):
    __tablename__ = "merchant_notify_links"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    telegram_chat_id = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company")

    __table_args__ = (
        UniqueConstraint("company_id", "telegram_chat_id", name="uq_merchant_notify_company_chat"),
        Index("ix_merchant_notify_company_id", "company_id"),
    )
