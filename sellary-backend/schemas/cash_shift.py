from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ShiftTotals(BaseModel):
    """Every till movement in a window, split by method. The single shape used
    for a live shift, a saved snapshot, and a closed shift's frozen totals."""

    cash_sales: Decimal = Decimal("0.00")
    card_sales: Decimal = Decimal("0.00")
    # card_sales broken out by card provider (dc / eskhata / alif).
    card_by_type: Dict[str, Decimal] = Field(default_factory=dict)
    mobile_sales: Decimal = Decimal("0.00")
    credit_sales: Decimal = Decimal("0.00")
    # Debt repayments that arrived during the shift, by method. Cash ones add to
    # the till; card/mobile ones do not.
    debt_payments_by_method: Dict[str, Decimal] = Field(default_factory=dict)
    # Refunds paid out during the shift, by method. Cash ones leave the till.
    refunds_by_method: Dict[str, Decimal] = Field(default_factory=dict)
    sales_count: int = 0
    # opening_cash + cash_sales + cash debt repayments − cash refunds.
    expected_cash: Decimal = Decimal("0.00")


class ShiftOpen(BaseModel):
    opening_cash: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)


class ShiftClose(BaseModel):
    counted_cash: Decimal = Field(..., ge=0, decimal_places=2)
    notes: Optional[str] = Field(None, max_length=500)


class ShiftSnapshotResponse(BaseModel):
    id: int
    taken_at: datetime
    taken_by_user_id: int
    totals: ShiftTotals

    class Config:
        from_attributes = True


class CashShift(BaseModel):
    id: int
    shift_number: int
    status: str
    opened_at: datetime
    opened_by_user_id: int
    opening_cash: Decimal
    closed_at: Optional[datetime] = None
    closed_by_user_id: Optional[int] = None
    counted_cash: Optional[Decimal] = None
    expected_cash: Optional[Decimal] = None
    discrepancy: Optional[Decimal] = None
    notes: Optional[str] = None
    # Live for an open shift; the frozen close for a closed one.
    totals: ShiftTotals

    class Config:
        from_attributes = True


class CashShiftDetail(CashShift):
    snapshots: List[ShiftSnapshotResponse] = Field(default_factory=list)
