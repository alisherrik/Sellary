"""Order item — a line within a marketplace order with price/name snapshot."""
from decimal import Decimal

from sqlalchemy import Column, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import relationship

from core.database import Base


class OrderItem(Base):
    """A single product line inside an Order.

    ``product_name`` and ``unit_price`` are snapshotted at order time so future
    product edits do not alter historical order records. ``product_id`` is kept
    as a FK for catalog cross-reference (nullable if the product is deleted).
    """

    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    # Price/name snapshot — survives product edits and deletions.
    product_name = Column(String(255), nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False)
    quantity = Column(Numeric(12, 3), nullable=False, default=Decimal("1.000"))
    line_total = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))

    order = relationship("Order", back_populates="items")
    product = relationship("Product")
