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
    quantity: int = Field(gt=0, description="Quantity to return")


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
    quantity_returned: int
    refund_amount: Decimal

    class Config:
        from_attributes = True


class SaleReturnResponse(BaseModel):
    """Response schema for a sale return."""
    id: int
    sale_id: int
    user_id: int
    user_name: str
    total_refund_amount: Decimal
    refund_method: PaymentMethod
    notes: Optional[str]
    created_at: datetime
    items: List[SaleReturnItemResponse]

    class Config:
        from_attributes = True
