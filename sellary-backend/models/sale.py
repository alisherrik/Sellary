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


def enum_values(enum_class: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_class]


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    cashier_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    subtotal = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    tax_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    discount_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    total_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    payment_method = Column(
        SQLEnum(
            PaymentMethod,
            values_callable=enum_values,
            create_constraint=False,
            native_enum=True,
            name="paymentmethod",
        ),
        nullable=False,
    )
    card_type = Column(
        SQLEnum(
            CardType,
            values_callable=enum_values,
            create_constraint=False,
            native_enum=True,
            name="cardtype",
        ),
        nullable=True,
    )  # Only used when payment_method=card
    status = Column(
        SQLEnum(
            SaleStatus,
            values_callable=enum_values,
            create_constraint=False,
            native_enum=True,
            name="salestatus",
        ),
        default=SaleStatus.COMPLETED,
    )
    notes = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    company = relationship("Company", back_populates="sales")
    customer = relationship("Customer", back_populates="sales")
    cashier = relationship("User", back_populates="sales")
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")
    returns = relationship("SaleReturn", back_populates="sale", cascade="all, delete-orphan")
