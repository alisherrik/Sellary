from decimal import Decimal
from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    Boolean,
    DateTime,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class ProductUnit(Base):
    """An alternative sale unit for a product (e.g. a sack, a 300 g portion).

    The product's own ``uom`` + ``sell_price`` are the implicit BASE unit
    (factor 1). Each row here is an *additional* sellable unit:

    - ``factor`` is how many base units one of this unit equals (1 sack = 5 kg
      -> factor 5; a 300 g portion of a kg-based product -> factor 0.3).
    - ``sell_price`` is the price for one of this unit.

    Stock and weighted-average cost stay in the base unit; a sale converts the
    chosen unit to base units (``sold_quantity * factor``) before touching the
    FIFO ledger, so inventory accounting is unaffected.

    Tenant scope is inherited through the parent product (same pattern as
    ``purchase_order_items`` / ``sale_items``).
    """

    __tablename__ = "product_units"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    name = Column(String(20), nullable=False)
    factor = Column(Numeric(12, 4), nullable=False)
    sell_price = Column(Numeric(10, 4), nullable=False)
    barcode = Column(String(50), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    product = relationship("Product", back_populates="units")
