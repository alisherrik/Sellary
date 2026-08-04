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

    The value is stored verbatim in ``inventory_logs.reference_type`` so stock
    movements can be grouped by cause without a schema change. Keep the values
    short — the column is ``String(50)``.
    """

    stocktake = "stocktake"
    damage = "damage"
    theft = "theft"
    surplus = "surplus"
    supplier_return = "supplier_return"
    other = "other"


STOCKTAKE_REASON_LABELS: dict[StocktakeReason, str] = {
    StocktakeReason.stocktake: "Инвентаризация",
    StocktakeReason.damage: "Бой / брак",
    StocktakeReason.theft: "Недостача / хищение",
    StocktakeReason.surplus: "Излишек",
    StocktakeReason.supplier_return: "Возврат поставщику",
    StocktakeReason.other: "Прочее",
}


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
