from decimal import Decimal
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    MOBILE = "mobile"


class CardType(str, Enum):
    ALIF = "alif"
    ESKHATA = "eskhata"
    DC = "dc"


class SaleContextType(str, Enum):
    RETAIL = "retail"
    RESTAURANT = "restaurant"


class SaleStatus(str, Enum):
    COMPLETED = "completed"
    PARTIALLY_RETURNED = "partially_returned"
    RETURNED = "returned"
    CANCELLED = "cancelled"


class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(..., gt=0)
    unit_price: Decimal = Field(..., ge=0, decimal_places=2)
    tax_percent: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    items: List[SaleItemCreate]
    payment_method: PaymentMethod
    card_type: Optional[CardType] = None  # Required when payment_method is card
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    notes: Optional[str] = None
    context_type: SaleContextType = Field(default=SaleContextType.RETAIL)
    table_name: Optional[str] = Field(None, max_length=50)


class SaleItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    quantity: int
    quantity_returned: int
    quantity_returnable: int  # quantity - quantity_returned
    can_return: bool  # quantity_returnable > 0
    unit_price: Decimal
    tax_percent: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    subtotal: Decimal
    total: Decimal

    class Config:
        from_attributes = True

    def __getitem__(self, key: str):
        return getattr(self, key)


class Sale(BaseModel):
    id: int
    customer_id: Optional[int]
    customer_name: Optional[str]
    cashier_id: int
    cashier_name: str
    subtotal: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total_amount: Decimal
    refunded_amount: Decimal  # Total amount refunded
    remaining_refundable_amount: Decimal  # total_amount - refunded_amount
    payment_method: PaymentMethod
    card_type: Optional[CardType]
    status: SaleStatus
    can_return: bool  # True if sale can be returned
    notes: Optional[str]
    context_type: SaleContextType
    table_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class SaleResponse(Sale):
    items: List[SaleItemResponse]
