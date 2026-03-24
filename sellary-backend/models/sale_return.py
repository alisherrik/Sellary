"""
Sale Return models for handling refunds and returns.
"""
from decimal import Decimal
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base
from models.sale import PaymentMethod


def enum_values(enum_class):
    return [member.value for member in enum_class]


class SaleReturn(Base):
    """
    Represents a return/refund transaction for a sale.
    A sale can have multiple returns (partial returns).
    """
    __tablename__ = "sale_returns"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    total_refund_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    refund_method = Column(
        SQLEnum(
            PaymentMethod,
            values_callable=enum_values,
            create_constraint=False,
            native_enum=True,
            name="paymentmethod",
        ),
        nullable=False,
    )
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Relationships
    company = relationship("Company", back_populates="sale_returns")
    sale = relationship("Sale", back_populates="returns")
    user = relationship("User", back_populates="sale_returns")
    items = relationship("SaleReturnItem", back_populates="sale_return", cascade="all, delete-orphan")


class SaleReturnItem(Base):
    """
    Individual items returned as part of a sale return.
    """
    __tablename__ = "sale_return_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_return_id = Column(Integer, ForeignKey("sale_returns.id"), nullable=False)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=False)
    quantity_returned = Column(Integer, nullable=False)
    refund_amount = Column(Numeric(12, 2), nullable=False)

    # Relationships
    sale_return = relationship("SaleReturn", back_populates="items")
    sale_item = relationship("SaleItem", back_populates="return_items")
