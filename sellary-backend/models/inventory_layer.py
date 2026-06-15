from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class InventoryLayer(Base):
    __tablename__ = "inventory_layers"
    __table_args__ = (
        CheckConstraint("original_quantity >= 0", name="ck_inventory_layers_original_nonnegative"),
        CheckConstraint("remaining_quantity >= 0", name="ck_inventory_layers_remaining_nonnegative"),
        CheckConstraint(
            "remaining_quantity <= original_quantity",
            name="ck_inventory_layers_remaining_lte_original",
        ),
        Index(
            "ix_inventory_layers_fifo",
            "company_id",
            "product_id",
            "reversed_at",
            "created_at",
            "id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    source_type = Column(String(50), nullable=False)
    source_id = Column(Integer, nullable=False)
    purchase_receipt_item_id = Column(
        Integer, ForeignKey("purchase_receipt_items.id"), unique=True
    )
    original_quantity = Column(Numeric(10, 3), nullable=False)
    remaining_quantity = Column(Numeric(10, 3), nullable=False)
    unit_cost = Column(Numeric(10, 2), nullable=False)
    reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reversed_at = Column(DateTime(timezone=True))

    product = relationship("Product", back_populates="inventory_layers")
    purchase_receipt_item = relationship(
        "PurchaseReceiptItem", back_populates="inventory_layer"
    )
    reversal_operation = relationship("ReversalOperation")
    allocations = relationship("InventoryAllocation", back_populates="layer")


class InventoryAllocation(Base):
    __tablename__ = "inventory_allocations"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_inventory_allocations_quantity_positive"),
        CheckConstraint(
            "released_quantity >= 0",
            name="ck_inventory_allocations_released_nonnegative",
        ),
        CheckConstraint(
            "released_quantity <= quantity",
            name="ck_inventory_allocations_released_lte_quantity",
        ),
        Index("ix_inventory_allocations_consumer", "company_id", "consumer_type", "consumer_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    layer_id = Column(Integer, ForeignKey("inventory_layers.id"), nullable=False)
    consumer_type = Column(String(50), nullable=False)
    consumer_id = Column(Integer, nullable=False)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"))
    quantity = Column(Numeric(10, 3), nullable=False)
    released_quantity = Column(Numeric(10, 3), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    layer = relationship("InventoryLayer", back_populates="allocations")
    sale_item = relationship("SaleItem", back_populates="allocations")
