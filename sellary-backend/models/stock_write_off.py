"""Taking goods off the shelf as a document.

Two independent axes, deliberately not folded into one list: ``reason_code``
says why the goods are unsellable, ``disposition`` says where they went. That
is what lets a report answer "порча 400, из них 250 вернули поставщику" — a
single flat list of reasons could not.
"""

from decimal import Decimal

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base

# Where the goods went.
DISPOSED = "disposed"
RETURNED_TO_SUPPLIER = "returned_to_supplier"
DISPOSITIONS = (DISPOSED, RETURNED_TO_SUPPLIER)

# Why they left the shelf.
REASON_CODES = (
    "spoiled",        # порча
    "damaged",        # бой / повреждение при хранении
    "defective",      # заводской брак
    "expired",        # просрочка — picked by hand, there is no batch tracking
    "lost",           # утеряно / кража
    "shortage",       # недостача по инвентаризации
    "internal_use",   # ушло на собственные нужды
)

# Both are stored as String, not a native Postgres enum: SQLite tolerates a bad
# enum value in tests and Postgres rejects it in production, which is how the
# money accounts work shipped the same bug twice. Validation lives in the
# schema layer, where a bad value is a 422 rather than a 500.


class StockWriteOff(Base):
    """One act of writing goods off.

    ``total_cost`` is a frozen fact, written once from what the FIFO ledger
    actually consumed. It is never recomputed from today's ``cost_price`` — the
    layers that fed this document may be gone tomorrow.
    """

    __tablename__ = "stock_write_offs"
    __table_args__ = (
        Index("ix_stock_write_offs_company_created", "company_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    disposition = Column(String(24), nullable=False)
    reason_code = Column(String(24), nullable=False)
    # Set only on a return: who took the goods back. A return moves no money —
    # there is no supplier balance in this system to reduce.
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    notes = Column(Text)
    total_cost = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    company = relationship("Company")
    supplier = relationship("Supplier")
    created_by_user = relationship("User")
    items = relationship(
        "StockWriteOffItem",
        back_populates="write_off",
        cascade="all, delete-orphan",
    )


class StockWriteOffItem(Base):
    """One product line.

    Tenant scope is inherited through the parent, the same way ``sale_items``
    and ``purchase_order_items`` do it.
    """

    __tablename__ = "stock_write_off_items"

    id = Column(Integer, primary_key=True, index=True)
    write_off_id = Column(
        Integer, ForeignKey("stock_write_offs.id"), nullable=False, index=True
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    # NULL means the product's own base unit.
    product_unit_id = Column(Integer, ForeignKey("product_units.id"), nullable=True)
    # What the user typed, in the unit they picked.
    unit_quantity = Column(Numeric(12, 3), nullable=False)
    # Base units — what actually left stock. Same rule as sale_items.quantity.
    quantity = Column(Numeric(10, 3), nullable=False)
    unit_cost = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))
    line_cost = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))

    write_off = relationship("StockWriteOff", back_populates="items")
    product = relationship("Product")
    product_unit = relationship("ProductUnit")
