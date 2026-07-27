"""
Schemas for Sale Return operations.
"""
from typing import List, Optional
from decimal import Decimal
from datetime import datetime
from pydantic import BaseModel, Field
from models.sale import PaymentMethod


class SaleReturnItemCreate(BaseModel):
    """Schema for creating a return item."""
    sale_item_id: int
    quantity: Decimal = Field(gt=0, decimal_places=3, description="Quantity to return")


class SaleReturnCreate(BaseModel):
    """Schema for creating a sale return."""
    items: List[SaleReturnItemCreate]
    refund_method: PaymentMethod
    notes: Optional[str] = None


class SaleReturnItemResponse(BaseModel):
    """Response schema for a returned item."""
    id: int
    sale_item_id: int
    product_name: str
    quantity_returned: Decimal
    refund_amount: Decimal

    class Config:
        from_attributes = True


class SaleReturnResponse(BaseModel):
    """Response schema for a sale return."""
    id: int
    sale_id: int
    user_id: int
    user_name: str
    # The value of the goods that came back.
    total_refund_amount: Decimal
    # Of that, how much was settled by cancelling the customer's debt...
    credit_refund_amount: Decimal = Decimal("0.00")
    # ...and how much actually changed hands. The two add up to the total.
    money_refund_amount: Decimal = Decimal("0.00")
    # How the money half was handed back. Meaningless when it is zero.
    refund_method: PaymentMethod
    notes: Optional[str]
    created_at: datetime
    items: List[SaleReturnItemResponse]

    class Config:
        from_attributes = True
