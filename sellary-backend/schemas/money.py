"""Request and response contracts for money accounts and their movements."""
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from models.money_account import IN_REASONS, OUT_REASONS

Direction = Literal["in", "out"]


class MoneyAccountOut(BaseModel):
    id: int
    name: str
    is_till: bool
    card_type: Optional[str]
    balance: Decimal
    opening_balance: Decimal
    opening_at: datetime
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True


class MoneyAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)


class MoneyAccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class MovementCreate(BaseModel):
    account_id: int
    direction: Direction
    amount: Decimal = Field(gt=0, decimal_places=2)
    reason: str = Field(max_length=32)
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_matches_direction(cls, value: str, info):
        direction = info.data.get("direction")
        allowed = IN_REASONS if direction == "in" else OUT_REASONS
        # Transfers are created through their own endpoint so both legs are
        # written together; a lone leg would read as money from nowhere.
        allowed = tuple(r for r in allowed if not r.startswith("transfer_"))
        if direction is not None and value not in allowed:
            raise ValueError(f"Недопустимая причина для направления «{direction}»")
        return value


class TransferCreate(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: Decimal = Field(gt=0, decimal_places=2)
    note: Optional[str] = Field(default=None, max_length=500)


class BalanceCorrection(BaseModel):
    """Set an account to a stated balance by recording the difference.

    The correction is a movement like any other, so the history keeps saying
    what happened instead of quietly changing what it once said.
    """

    account_id: int
    actual_balance: Decimal = Field(ge=0, decimal_places=2)
    note: Optional[str] = Field(default=None, max_length=500)


class MovementOut(BaseModel):
    id: int
    account_id: int
    account_name: str
    direction: Direction
    amount: Decimal
    reason: str
    reason_label: str
    transfer_group: Optional[str]
    note: Optional[str]
    created_by_user_id: int
    created_by_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class MoneyOverview(BaseModel):
    accounts: list[MoneyAccountOut]
    total: Decimal
    cash_total: Decimal
    noncash_total: Decimal
