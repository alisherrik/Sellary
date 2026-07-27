"""How a sale was actually settled — one row per tender.

A customer hands over 26 in cash, taps 10 on a DC card and 10 on an Эсхата
card, and asks for the last 4 to go on their tab. That is one sale and four
tenders, and `sales.payment_method` — a single scalar — cannot hold it.

These rows are the truth about money for a sale. `sales.payment_method` still
carries the largest tender so that readers which have not been taught about
splits attribute the sale somewhere sensible rather than crashing, but every
figure that is about money — till balances, shift totals, the sales summary —
reads this table. Two channels for the same fact is how `stock_quantity` drifted
away from its FIFO layers in production, and this is the same trap.

The rows always sum to `sales.total_amount`, to the cent. That is enforced on
write and asserted by the backfill.
"""

from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base
from models.sale import CardType, PaymentMethod, enum_values


class SalePayment(Base):
    __tablename__ = "sale_payments"

    id = Column(Integer, primary_key=True, index=True)
    # Mirrored from the sale so the aggregates that drive balances and shift
    # totals can group without joining back to `sales` every time.
    company_id = Column(
        Integer, ForeignKey("companies.id"), nullable=False, index=True
    )
    sale_id = Column(
        Integer,
        ForeignKey("sales.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    method = Column(
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
    )
    amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    # The order the cashier entered them, so a receipt reads back the way the
    # payment happened.
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sale = relationship("Sale", back_populates="payments")

    __table_args__ = (
        # A zero tender is not a tender, and a negative one is a refund
        # pretending to be a payment.
        CheckConstraint("amount > 0", name="ck_sale_payments_amount_positive"),
        Index("ix_sale_payments_company_method", "company_id", "method"),
    )
