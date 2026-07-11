from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.sql import func

from core.database import Base


class CashierDevice(Base):
    """A registered offline-first cashier device (one active per shop).

    The device_token itself is never stored: only its sha256 hex digest
    (``token_hash``) is persisted so the credential is revocable and
    constant-time-verifiable. ``is_active`` is the single kill-switch.
    """

    __tablename__ = "cashier_devices"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_id = Column(String(64), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=True)
    token_hash = Column(String(64), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        Index("ix_cashier_devices_company_active", "company_id", "is_active"),
    )
