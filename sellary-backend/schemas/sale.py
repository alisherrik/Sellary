from decimal import Decimal
from pydantic import BaseModel, Field, model_validator
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


class SaleStatus(str, Enum):
    COMPLETED = "completed"
    PARTIALLY_RETURNED = "partially_returned"
    RETURNED = "returned"
    CANCELLED = "cancelled"


class SaleItemCreate(BaseModel):
    product_id: int
    quantity: Decimal = Field(..., gt=0, decimal_places=3)
    unit_price: Decimal = Field(..., ge=0, decimal_places=2)
    tax_percent: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    items: List[SaleItemCreate] = Field(..., min_length=1)
    payment_method: PaymentMethod
    card_type: Optional[CardType] = None
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_card_type(self):
        if self.payment_method == PaymentMethod.CARD and not self.card_type:
            raise ValueError("card_type is required when payment_method is card")
        if self.payment_method != PaymentMethod.CARD and self.card_type:
            raise ValueError("card_type must not be set when payment_method is not card")
        return self


class SaleItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    uom: str
    quantity: Decimal
    quantity_returned: Decimal
    quantity_returnable: Decimal
    can_return: bool
    unit_price: Decimal
    tax_percent: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    subtotal: Decimal
    total: Decimal

    class Config:
        from_attributes = True


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
    created_at: datetime

    class Config:
        from_attributes = True


class SaleResponse(Sale):
    items: List[SaleItemResponse]
