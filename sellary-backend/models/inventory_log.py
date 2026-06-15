from decimal import Decimal
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import relationship
from core.database import Base


class InventoryLog(Base):
    __tablename__ = "inventory_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    quantity_change = Column(Numeric(10, 3), nullable=False)
    value_change = Column(
        Numeric(16, 4),
        nullable=False,
        default=Decimal("0.0000"),
        server_default=text("0.0000"),
    )
    previous_quantity = Column(Numeric(10, 3), nullable=False)
    new_quantity = Column(Numeric(10, 3), nullable=False)
    reason = Column(String(255))
    reference_type = Column(String(50))  # sale, adjustment, restock
    reference_id = Column(Integer)
    reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    company = relationship("Company", back_populates="inventory_logs")
    product = relationship("Product", back_populates="inventory_logs")
    user = relationship("User", back_populates="inventory_logs")
    reversal_operation = relationship("ReversalOperation")
