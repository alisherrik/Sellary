"""Order domain model — marketplace order request.

An Order is a shopper's purchase request. It does NOT touch stock directly;
stock is committed when a merchant confirms (creating a Sale via SaleService).
The order lifecycle: pending → confirmed → preparing → ready →
  delivery: delivering → completed
  pickup: completed
plus cancelled at any pre-confirmed step (or post-confirm via sale reversal).
"""
import enum
from decimal import Decimal

from sqlalchemy import (
    Column,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    DateTime,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PREPARING = "preparing"
    READY = "ready"
    DELIVERING = "delivering"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class FulfillmentType(str, enum.Enum):
    DELIVERY = "delivery"
    PICKUP = "pickup"


class Order(Base):
    """One merchant's portion of a shopper's cart checkout.

    A multi-vendor cart produces N Orders sharing a ``checkout_group_id`` (one
    UUID per checkout, supplied by the shopper). Stock is *not* touched here;
    the FIFO ledger runs only when a merchant confirms (setting ``sale_id``).
    """

    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    telegram_user_id = Column(
        Integer, ForeignKey("telegram_users.id"), nullable=False
    )
    customer_id = Column(
        Integer, ForeignKey("customers.id"), nullable=True
    )
    order_number = Column(Integer, nullable=False)
    status = Column(String(32), nullable=False, default=OrderStatus.PENDING.value)
    fulfillment_type = Column(String(16), nullable=False)
    delivery_address = Column(Text, nullable=True)
    contact_phone = Column(String(32), nullable=False)
    contact_name = Column(String(150), nullable=False)
    subtotal = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    total_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    notes = Column(Text, nullable=True)
    # Set on merchant confirm; NULL while pending.
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    # Groups all orders from a single cart checkout.
    checkout_group_id = Column(String(36), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    company = relationship("Company")
    telegram_user = relationship("TelegramUser")
    customer = relationship("Customer")
    sale = relationship("Sale")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_orders_company_status", "company_id", "status"),
        Index("ix_orders_telegram_user_id", "telegram_user_id"),
    )
