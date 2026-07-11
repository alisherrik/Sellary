from decimal import Decimal
from sqlalchemy import Column, Integer, Numeric, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity_ordered = Column(Numeric(10, 3), nullable=False)
    quantity_received = Column(Numeric(10, 3), default=0)
    unit_cost = Column(Numeric(10, 4), nullable=False)
    subtotal = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Line-level annulment audit trail. The ordered/received quantities and
    # subtotal above stay unchanged for audit; these record that this single
    # line was reversed. Purchase totals/status exclude voided items.
    voided_at = Column(DateTime(timezone=True))
    voided_by_user_id = Column(Integer, ForeignKey("users.id"))
    void_reason = Column(Text)
    reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"))

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    product = relationship("Product", back_populates="purchase_order_items")
    receipt_items = relationship(
        "PurchaseReceiptItem", back_populates="purchase_order_item"
    )
    voided_by_user = relationship("User", foreign_keys=[voided_by_user_id])
    reversal_operation = relationship("ReversalOperation")

    @property
    def is_voided(self) -> bool:
        return self.voided_at is not None
