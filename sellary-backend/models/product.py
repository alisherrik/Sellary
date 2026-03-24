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
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base
import enum


class ProductType(str, enum.Enum):
    ITEM = "item"
    DISH = "dish"


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("company_id", "barcode", name="uq_products_company_barcode"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    product_type = Column(
        SQLEnum(ProductType, values_callable=lambda x: [e.value for e in x], create_constraint=False, native_enum=True, name='producttype'),
        default=ProductType.ITEM
    )
    barcode = Column(String(50), index=True, nullable=True)
    name = Column(String(200), index=True, nullable=False)
    description = Column(String(500))
    category_id = Column(Integer, ForeignKey("categories.id"))
    cost_price = Column(Numeric(10, 2), nullable=False)
    sell_price = Column(Numeric(10, 2), nullable=False)
    tax_percent = Column(Numeric(5, 2), default=Decimal("0.00"))
    stock_quantity = Column(Integer, default=0)
    min_stock_level = Column(Integer, default=5)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    company = relationship("Company", back_populates="products")
    category = relationship("Category", back_populates="products")
    sale_items = relationship("SaleItem", back_populates="product")
    inventory_logs = relationship("InventoryLog", back_populates="product")
    purchase_order_items = relationship("PurchaseOrderItem", back_populates="product")
