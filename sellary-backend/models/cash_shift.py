import enum
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
    Enum as SQLEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

# JSONB on Postgres, JSON on the SQLite test engine (which can't render JSONB).
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")
from sqlalchemy.sql import func

from core.database import Base
from models.sale import enum_values


class CashShiftStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"


class CashShift(Base):
    """A cashier's till session: opened with a cash float, closed with a count.

    There is no shift_id on sales. A shift is a time window, and every till
    movement — sale, refund, debt repayment — belongs to whichever shift's
    [opened_at, closed_at) it falls in. This keeps `sales` untouched and lets an
    offline sale land in the right shift purely by its timestamp. The computed
    totals are frozen onto the row at close (`closing_totals`) so a sale that
    syncs in afterwards can never rewrite a closed shift's numbers.
    """

    __tablename__ = "cash_shifts"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    # Per-company sequential label ("Смена №5"), assigned at open.
    shift_number = Column(Integer, nullable=False)
    status = Column(
        SQLEnum(
            CashShiftStatus,
            values_callable=enum_values,
            create_constraint=False,
            native_enum=True,
            name="cashshiftstatus",
        ),
        nullable=False,
        default=CashShiftStatus.OPEN,
        index=True,
    )

    opened_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    opened_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    opening_cash = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))

    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # What the cashier physically counted at handover.
    counted_cash = Column(Numeric(12, 2), nullable=True)
    # What the till should hold: opening + cash sales + cash debt repayments
    # − cash refunds. Frozen at close.
    expected_cash = Column(Numeric(12, 2), nullable=True)
    # counted − expected. Negative = недостача (short), positive = излишек.
    discrepancy = Column(Numeric(12, 2), nullable=True)
    # Full per-method breakdown frozen at close (ShiftTotals payload).
    closing_totals = Column(JSON_TYPE, nullable=True)

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company")
    snapshots = relationship(
        "CashShiftSnapshot",
        back_populates="shift",
        cascade="all, delete-orphan",
        order_by="CashShiftSnapshot.taken_at",
    )

    __table_args__ = (
        # At most one open shift per company. Enforced by the DB, not by app
        # code — two concurrent opens must not both win. Partial unique index,
        # so closed shifts never collide.
        Index(
            "uq_cash_shifts_one_open_per_company",
            "company_id",
            unique=True,
            # Both dialects: without sqlite_where the SQLite test engine would
            # make this a plain unique index on company_id and forbid a company
            # from ever having two shifts. SQLite (3.8+) supports partial
            # indexes, so the same guarantee holds in tests.
            postgresql_where=(status == "open"),
            sqlite_where=(status == "open"),
        ),
    )


class CashShiftSnapshot(Base):
    """An X-report: the till breakdown at a moment, taken without closing.

    A snapshot never mutates the shift — it is a saved read.
    """

    __tablename__ = "cash_shift_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    shift_id = Column(Integer, ForeignKey("cash_shifts.id"), nullable=False, index=True)
    taken_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    taken_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    totals = Column(JSON_TYPE, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shift = relationship("CashShift", back_populates="snapshots")
