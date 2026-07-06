from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from schemas.sale import PaymentMethod


class CustomerLedgerEntryType(str, Enum):
    CREDIT_SALE = "credit_sale"
    PAYMENT = "payment"
    RETURN_ADJUSTMENT = "return_adjustment"
    CANCEL_ADJUSTMENT = "cancel_adjustment"


class CustomerPaymentCreate(BaseModel):
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: PaymentMethod
    description: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_real_payment_method(self):
        if self.payment_method == PaymentMethod.CREDIT:
            raise ValueError("credit is not a valid debt payment method")
        return self


class CustomerLedgerEntryResponse(BaseModel):
    id: int
    customer_id: int
    sale_id: Optional[int]
    entry_type: CustomerLedgerEntryType
    amount: Decimal
    payment_method: Optional[PaymentMethod] = None
    description: Optional[str]
    created_by_user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class CustomerLedgerResponse(BaseModel):
    customer_id: int
    balance: Decimal
    entries: list[CustomerLedgerEntryResponse]


class CustomerPaymentResponse(BaseModel):
    customer_id: int
    balance: Decimal
    entries: list[CustomerLedgerEntryResponse]
