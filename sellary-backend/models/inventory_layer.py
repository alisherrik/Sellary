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
            "created_at",
            "id",
        ),
    )

    id = Column(Integer, primary_key=True)
    company_id = Column(
        Integer, ForeignKey("companies.id"), nullable=False, index=True
    )
    product_id = Column(
        Integer, ForeignKey("products.id"), nullable=False, index=True
    )
    source_type = Column(String(40), nullable=False)
    source_id = Column(Integer, nullable=True)
    purchase_receipt_item_id = Column(
        Integer,
        ForeignKey("purchase_receipt_items.id"),
        unique=True,
        index=True,
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
    )

    id = Column(Integer, primary_key=True)
    company_id = Column(
        Integer, ForeignKey("companies.id"), nullable=False, index=True
    )
    product_id = Column(
        Integer, ForeignKey("products.id"), nullable=False, index=True
    )
    layer_id = Column(
        Integer, ForeignKey("inventory_layers.id"), nullable=False, index=True
    )
    consumer_type = Column(String(40), nullable=False)
    consumer_id = Column(Integer, nullable=False)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"), index=True)
    quantity = Column(Numeric(10, 3), nullable=False)
    released_quantity = Column(
        Numeric(10, 3), nullable=False, default=0, server_default="0"
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    layer = relationship("InventoryLayer", back_populates="allocations")
    sale_item = relationship("SaleItem", back_populates="allocations")
