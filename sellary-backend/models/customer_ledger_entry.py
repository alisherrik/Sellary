import enum
from decimal import Decimal

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class CustomerLedgerEntryType(str, enum.Enum):
    CREDIT_SALE = "credit_sale"
    PAYMENT = "payment"
    # Money handed over at the till as part of the sale itself, not a later
    # repayment. It offsets the debt exactly as a payment does, so the balance
    # is unchanged, but it is NOT a debt repayment: the same money is already
    # recorded as a tender in `sale_payments`, and counting it in both places
    # would put it in the shift twice. Every money reader filters on
    # `payment`, so a distinct type keeps them right without touching them.
    SALE_TENDER = "sale_tender"
    RETURN_ADJUSTMENT = "return_adjustment"
    CANCEL_ADJUSTMENT = "cancel_adjustment"


class CustomerLedgerEntry(Base):
    __tablename__ = "customer_ledger_entries"
    __table_args__ = (
        Index("ix_customer_ledger_company_customer_created", "company_id", "customer_id", "created_at"),
        Index("ix_customer_ledger_company_sale", "company_id", "sale_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    entry_type = Column(String(32), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    payment_method = Column(String(20), nullable=True)
    description = Column(String(500), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    customer = relationship("Customer", back_populates="ledger_entries")
    sale = relationship("Sale", back_populates="customer_ledger_entries")
    created_by_user = relationship("User")
