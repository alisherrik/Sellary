from decimal import Decimal
from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class InventoryLog(BaseModel):
    id: int
    product_id: int
    product_name: str
    user_id: int
    user_name: str
    quantity_change: Decimal
    value_change: Decimal
    previous_quantity: Decimal
    new_quantity: Decimal
    reason: Optional[str]
    reference_type: Optional[str]
    reference_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class InventoryAdjustment(BaseModel):
    product_id: int
    quantity_change: Decimal
    reason: str


class StocktakeReason(str, Enum):
    """Why a counted quantity differs from the recorded one.

    These describe an **unexplained** difference found by counting. Goods that
    are known to be unsellable — spoiled, broken, or going back to the supplier
    — leave the shelf as a ``stock_write_offs`` document instead, which records
    the reason, the disposition and the cost the ledger actually consumed. Do
    not add those causes here; that would be a second channel for the same fact.

    The value is stored verbatim in ``inventory_logs.reference_type`` so stock
    movements group by cause without a schema change. Keep the values short —
    the column is ``String(50)``.
    """

    stocktake = "stocktake"
    surplus = "surplus"
    shortage = "shortage"
    other = "other"


STOCKTAKE_REASON_LABELS: dict[StocktakeReason, str] = {
    StocktakeReason.stocktake: "Инвентаризация",
    StocktakeReason.surplus: "Излишек",
    StocktakeReason.shortage: "Недостача",
    StocktakeReason.other: "Прочее",
}


# What the Инвентаризация page reads back. Derived from the enum rather than
# hand-listed, so a new reason cannot be added above and forgotten here.
# `manual_adjust` is the removed edit-form quantity box — a dead channel, but its
# rows are real corrections to counted stock and an audit that omits them is
# worse than one that shows them.
STOCKTAKE_REFERENCE_TYPES: tuple[str, ...] = tuple(
    reason.value for reason in StocktakeReason
) + ("manual_adjust",)


class StocktakeRequest(BaseModel):
    """An absolute physical count, not a delta.

    ``expected_quantity`` is the stock the operator was shown when the dialog
    opened. The server refuses the write when it no longer matches, so a stale
    page cannot apply a correction to a figure that moved underneath it. It
    carries no lower bound: offline sync tolerates oversell, so a product can
    legitimately sit below zero and must still be countable.
    """

    product_id: int
    counted_quantity: Decimal = Field(ge=0)
    expected_quantity: Decimal
    reason: StocktakeReason
    note: Optional[str] = Field(None, max_length=255)
