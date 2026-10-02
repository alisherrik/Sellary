"""Typed response contracts for the retained upstream MCP tool names."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from schemas.cash_shift import ShiftTotals
from schemas.consistency import FindingOut
from schemas.mcp_read import ConsistencyPage, Page
from schemas.order import OrderResponse
from schemas.reconciliation import PeriodDetail, PeriodList


class CompatShift(BaseModel):
    id: int
    shift_number: int
    status: Literal["open", "closed"]
    opened_at: datetime
    closed_at: datetime | None
    opening_cash: Decimal
    opening_notes: str | None
    expected_cash: Decimal | None
    counted_cash: Decimal | None
    discrepancy: Decimal | None
    notes: str | None


class CompatShiftResult(BaseModel):
    shift: CompatShift | None
    totals: ShiftTotals | None = None
    message: str | None = None


class CompatPeriodPage(PeriodList, Page):
    total: int


class CompatPeriodReport(PeriodDetail):
    checker_report: list[FindingOut] | None = None


class CompatShopPage(Page):
    total: int
    orders: list[OrderResponse]


class CompatConsistencyPage(ConsistencyPage):
    pass
