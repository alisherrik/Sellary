from sqlalchemy import (
    BigInteger,
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    ForeignKey,
    UniqueConstraint,
    Index,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        UniqueConstraint("company_id", "phone", name="uq_customers_company_phone"),
        Index(
            "uq_customers_company_client_customer_id",
            "company_id",
            "client_customer_id",
            unique=True,
            sqlite_where=text("client_customer_id IS NOT NULL"),
            postgresql_where=text("client_customer_id IS NOT NULL"),
        ),
        Index(
            "uq_customers_company_telegram_id",
            "company_id",
            "telegram_id",
            unique=True,
            sqlite_where=text("telegram_id IS NOT NULL"),
            postgresql_where=text("telegram_id IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(100), index=True)
    phone = Column(String(20), index=True)
    email = Column(String(100))
    address = Column(String(255))
    description = Column(String(500))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # C1: local-origin id from the offline cashier. NULL for web-created rows; a
    # partial unique index (above) dedupes per company without constraining NULLs.
    client_customer_id = Column(String(64), nullable=True, index=True)
    # F2 marketplace: links this per-shop Customer to a global Telegram shopper.
    # NULL for web/POS-created rows; the partial unique index (above) dedupes per
    # company without constraining NULLs — mirrors client_customer_id.
    telegram_id = Column(BigInteger, nullable=True, index=True)

    company = relationship("Company", back_populates="customers")
    sales = relationship("Sale", back_populates="customer")
    ledger_entries = relationship("CustomerLedgerEntry", back_populates="customer")
