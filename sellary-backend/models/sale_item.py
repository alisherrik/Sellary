from decimal import Decimal
from sqlalchemy import Column, Integer, Numeric, DateTime, ForeignKey, String, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Numeric(10, 3), nullable=False)
    quantity_returned = Column(Numeric(10, 3), nullable=False, default=0)  # Track returned quantity
    unit_price = Column(Numeric(10, 2), nullable=False)
    tax_percent = Column(Numeric(5, 2), nullable=False, default=Decimal("0.00"))
    tax_amount = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    discount_amount = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    subtotal = Column(Numeric(12, 2), nullable=False)
    total = Column(Numeric(12, 2), nullable=False)
    allocated_sale_discount_amount = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    unit_cost_at_sale = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    cost_total_at_sale = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")
    return_items = relationship("SaleReturnItem", back_populates="sale_item")

    __table_args__ = (
        Index("ix_sale_items_sale_id", "sale_id"),
        Index("ix_sale_items_product_id", "product_id"),
    )
    
    @property
    def returnable_quantity(self):
        """Calculate how many items can still be returned."""
        return self.quantity - self.quantity_returned
