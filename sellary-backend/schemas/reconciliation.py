from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ReconciliationCreate(BaseModel):
    effective_from: date
    note: Optional[str] = Field(None, max_length=500)
    # Reconcile anyway over drift the checker found, recording what was known
    # to be broken instead of pretending the period was clean.
    acknowledge_violations: bool = False


class ReconciliationRead(BaseModel):
    id: int
    effective_from: date
    created_at: datetime
    created_by_user_id: Optional[int] = None
    note: Optional[str] = None

    model_config = {"from_attributes": True}


class ReconciliationState(BaseModel):
    latest: Optional[ReconciliationRead] = None
    history: list[ReconciliationRead] = []


class PeriodRow(BaseModel):
    id: int
    index: int
    start_day: Optional[date] = None
    end_day: date
    note: Optional[str] = None
    purchased: Decimal
    sold: Decimal


class PeriodList(BaseModel):
    total: int
    periods: list[PeriodRow] = []


class LateArrivals(BaseModel):
    """Receipts dated inside the period that reached the server after it closed.

    Named rather than absorbed — the same move the shift panel makes with its
    own `late_arrivals` line.
    """

    count: int = 0
    total: Decimal = Decimal("0.00")


class PeriodDetail(BaseModel):
    id: int
    index: int
    start_day: Optional[date] = None
    end_day: date
    effective_from: date
    note: Optional[str] = None
    declared_at: datetime
    declared_by: Optional[str] = None

    purchased: Decimal
    receipts_count: int

    # Already net of returns. `returns_total` below is informational; never
    # subtract it again.
    sold: Decimal
    sales_count: int
    cost: Decimal
    profit: Decimal
    write_off_cost: Decimal
    profit_after_write_offs: Decimal
    returns_total: Decimal

    late_arrivals: LateArrivals
    checker_report: Optional[list] = None
