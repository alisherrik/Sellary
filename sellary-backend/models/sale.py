from decimal import Decimal
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum as SQLEnum, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base
import enum


class SaleStatus(str, enum.Enum):
    COMPLETED = "completed"
    PARTIALLY_RETURNED = "partially_returned"
    RETURNED = "returned"
    CANCELLED = "cancelled"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    CARD = "card"
    MOBILE = "mobile"


class CardType(str, enum.Enum):
    ALIF = "alif"
    ESKHATA = "eskhata"
    DC = "dc"


class SaleContextType(str, enum.Enum):
    RETAIL = "retail"
    RESTAURANT = "restaurant"


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    cashier_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    context_type = Column(
        SQLEnum(SaleContextType, values_callable=lambda x: [e.value for e in x], create_constraint=False, native_enum=True, name='salecontexttype'),
        default=SaleContextType.RETAIL, index=True
    )
    table_name = Column(String(50), nullable=True)
    subtotal = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    tax_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    discount_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    total_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    payment_method = Column(SQLEnum(PaymentMethod), nullable=False)
    card_type = Column(SQLEnum(CardType), nullable=True)  # Only used when payment_method=card
    status = Column(SQLEnum(SaleStatus), default=SaleStatus.COMPLETED)
    notes = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    customer = relationship("Customer", back_populates="sales")
    cashier = relationship("User", back_populates="sales")
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")
    returns = relationship("SaleReturn", back_populates="sale", cascade="all, delete-orphan")
