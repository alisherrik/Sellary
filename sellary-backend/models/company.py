from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    slug = Column(String(150), unique=True, index=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    memberships = relationship(
        "CompanyMembership",
        back_populates="company",
        cascade="all, delete-orphan",
    )
    categories = relationship("Category", back_populates="company")
    customers = relationship("Customer", back_populates="company")
    products = relationship("Product", back_populates="company")
    suppliers = relationship("Supplier", back_populates="company")
    purchase_orders = relationship("PurchaseOrder", back_populates="company")
    sales = relationship("Sale", back_populates="company")
    sale_returns = relationship("SaleReturn", back_populates="company")
    inventory_logs = relationship("InventoryLog", back_populates="company")
    idempotency_keys = relationship("IdempotencyKey", back_populates="company")
