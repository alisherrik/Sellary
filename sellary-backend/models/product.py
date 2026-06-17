from decimal import Decimal
from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Enum as SQLEnum,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base
import enum


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("company_id", "barcode", name="uq_products_company_barcode"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    barcode = Column(String(50), index=True, nullable=True)
    name = Column(String(200), index=True, nullable=False)
    description = Column(String(500))
    uom = Column(String(20), nullable=False, default="dona")
    category_id = Column(Integer, ForeignKey("categories.id"))
    cost_price = Column(Numeric(10, 4), nullable=False)
    sell_price = Column(Numeric(10, 2), nullable=False)
    tax_percent = Column(Numeric(5, 2), default=Decimal("0.00"))
    stock_quantity = Column(Numeric(10, 3), default=0)
    inventory_value = Column(
        Numeric(16, 4),
        nullable=False,
        default=Decimal("0.0000"),
        server_default=text("0.0000"),
    )
    min_stock_level = Column(Numeric(10, 3), default=5)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    company = relationship("Company", back_populates="products")
    category = relationship("Category", back_populates="products")
    sale_items = relationship("SaleItem", back_populates="product")
    inventory_logs = relationship("InventoryLog", back_populates="product")
    purchase_order_items = relationship("PurchaseOrderItem", back_populates="product")
    inventory_layers = relationship("InventoryLayer", back_populates="product")
    inventory_allocations = relationship("InventoryAllocation", back_populates="product")
