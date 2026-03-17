from decimal import Decimal
from sqlalchemy import Column, Integer, Numeric, DateTime, ForeignKey, String, Index
from sqlalchemy.orm import relationship
from core.database import Base


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    quantity_returned = Column(Integer, nullable=False, default=0)  # Track returned quantity
    unit_price = Column(Numeric(10, 2), nullable=False)
    tax_percent = Column(Numeric(5, 2), nullable=False)
    tax_amount = Column(Numeric(10, 2), nullable=False)
    discount_amount = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    subtotal = Column(Numeric(12, 2), nullable=False)
    total = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime, server_default="now()")

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")
    return_items = relationship("SaleReturnItem", back_populates="sale_item")

    __table_args__ = (
        Index("ix_sale_items_sale_id", "sale_id"),
        Index("ix_sale_items_product_id", "product_id"),
    )
    
    @property
    def returnable_quantity(self) -> int:
        """Calculate how many items can still be returned."""
        return self.quantity - self.quantity_returned
