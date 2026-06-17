from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class PurchaseReceipt(Base):
    __tablename__ = "purchase_receipts"

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    purchase_order_id = Column(
        Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reversed_at = Column(DateTime(timezone=True))

    items = relationship(
        "PurchaseReceiptItem",
        back_populates="receipt",
        cascade="all, delete-orphan",
    )
    purchase_order = relationship("PurchaseOrder", back_populates="receipts")
    user = relationship("User")
    reversal_operation = relationship("ReversalOperation")


class PurchaseReceiptItem(Base):
    __tablename__ = "purchase_receipt_items"

    id = Column(Integer, primary_key=True)
    purchase_receipt_id = Column(
        Integer, ForeignKey("purchase_receipts.id"), nullable=False, index=True
    )
    purchase_order_item_id = Column(
        Integer, ForeignKey("purchase_order_items.id"), nullable=False
    )
    product_id = Column(
        Integer, ForeignKey("products.id"), nullable=False, index=True
    )
    quantity = Column(Numeric(10, 3), nullable=False)
    unit_cost = Column(Numeric(10, 4), nullable=False)

    receipt = relationship("PurchaseReceipt", back_populates="items")
    purchase_order_item = relationship(
        "PurchaseOrderItem", back_populates="receipt_items"
    )
    product = relationship("Product")
    inventory_layer = relationship(
        "InventoryLayer", back_populates="purchase_receipt_item", uselist=False
    )
