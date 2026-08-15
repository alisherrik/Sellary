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
