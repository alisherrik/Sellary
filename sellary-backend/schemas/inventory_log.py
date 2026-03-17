from decimal import Decimal
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class InventoryLog(BaseModel):
    id: int
    product_id: int
    product_name: str
    user_id: int
    user_name: str
    quantity_change: int
    previous_quantity: int
    new_quantity: int
    reason: Optional[str]
    reference_type: Optional[str]
    reference_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class InventoryAdjustment(BaseModel):
    product_id: int
    quantity_change: int
    reason: str
