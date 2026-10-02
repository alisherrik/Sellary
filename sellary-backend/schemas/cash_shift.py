from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ShiftMovement(BaseModel):
    """One cash-in or cash-out recorded against the drawer during the shift."""

    id: int
    direction: str
    amount: Decimal
    reason: str
    reason_label: str
    note: Optional[str] = None
    created_at: datetime


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
    # Deliberate cash in and out of the drawer during the shift: change
    # brought in, takings sent to the bank, a supplier paid, card money
    # withdrawn and put in the till. Recorded as money_movements on the till
    # account; see services/money_service.py.
    movements_in: Decimal = Decimal("0.00")
    movements_out: Decimal = Decimal("0.00")
    movements: List[ShiftMovement] = Field(default_factory=list)
    # Cash the drawer holds that this shift's own window cannot account for.
    # Usually a closed shift whose `closing_totals` were frozen by an older
    # formula: a money fix does not reach back into them, so recomputing that
    # window today gives a different figure and the difference lands here.
    # Shown as its own line rather than folded into the total, so the
    # arithmetic on screen still adds up and a cashier is not charged with a
    # излишек that was never theirs.
    late_arrivals: Decimal = Decimal("0.00")
    # opening_cash + cash_sales + cash debt repayments − cash refunds
    # + movements_in − movements_out + late_arrivals. Equal to the till
    # account's balance whenever the company has one: there is one answer to
    # what the drawer holds, not one per screen.
    expected_cash: Decimal = Decimal("0.00")


class ShiftOpen(BaseModel):
    opening_cash: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    opening_notes: Optional[str] = Field(None, max_length=500)


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
    opening_notes: Optional[str] = None
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
