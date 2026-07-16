from decimal import Decimal
from pydantic import BaseModel, Field, model_validator
from typing import Literal, Optional, List
from datetime import datetime
from enum import Enum


class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    MOBILE = "mobile"
    CREDIT = "credit"


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
    # When `product_unit_id` is set, `quantity` and `unit_price` are expressed in
    # that chosen unit; the server converts to base units for inventory. When it
    # is None the sale is in the product's base unit (backward compatible).
    product_unit_id: Optional[int] = None
    quantity: Decimal = Field(..., gt=0, decimal_places=3)
    unit_price: Decimal = Field(..., ge=0, decimal_places=4)
    tax_percent: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    items: List[SaleItemCreate] = Field(..., min_length=1)
    payment_method: PaymentMethod
    card_type: Optional[CardType] = None
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    paid_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    initial_payment_method: Optional[PaymentMethod] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_card_type(self):
        if self.payment_method == PaymentMethod.CARD and not self.card_type:
            raise ValueError("card_type is required when payment_method is card")
        if self.payment_method != PaymentMethod.CARD and self.card_type:
            raise ValueError("card_type must not be set when payment_method is not card")
        if self.paid_amount > 0 and self.payment_method != PaymentMethod.CREDIT:
            raise ValueError("paid_amount is only supported for credit sales")
        if self.paid_amount > 0 and not self.initial_payment_method:
            raise ValueError("initial_payment_method is required when paid_amount is greater than zero")
        if self.initial_payment_method == PaymentMethod.CREDIT:
            raise ValueError("initial_payment_method cannot be credit")
        if self.paid_amount <= 0 and self.initial_payment_method:
            raise ValueError("initial_payment_method requires paid_amount")
        return self


class SaleItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    uom: str
    # quantity / quantity_* are in the product's base unit (inventory truth).
    quantity: Decimal
    quantity_returned: Decimal
    quantity_returnable: Decimal
    can_return: bool
    # What the cashier actually sold (chosen unit) — for receipts / history.
    product_unit_id: Optional[int] = None
    sold_quantity: Decimal
    sold_unit_label: Optional[str] = None
    sold_unit_factor: Decimal = Decimal("1")
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
    payment_status: str = "paid"
    credit_amount: Decimal = Decimal("0.00")
    credit_paid_amount: Decimal = Decimal("0.00")
    credit_remaining_amount: Decimal = Decimal("0.00")
    status: SaleStatus
    can_return: bool  # True if sale can be returned
    notes: Optional[str]
    created_at: datetime
    # Annulment (void) audit metadata — populated only once a sale is annulled.
    voided_at: Optional[datetime] = None
    voided_by_user_id: Optional[int] = None
    void_reason: Optional[str] = None
    reversal_operation_id: Optional[int] = None
    # C3: present only for sales that originated on an offline cashier device.
    client_sale_id: Optional[str] = None

    class Config:
        from_attributes = True


class SaleResponse(Sale):
    items: List[SaleItemResponse]


class SaleSearchSuggestion(BaseModel):
    kind: Literal["product", "cashier", "customer", "status", "payment"]
    label: str
    value: str
    score: int = Field(..., ge=0, le=100)


class SalesHourlyBucket(BaseModel):
    hour: int = Field(..., ge=0, le=23)  # local hour on the company's clock
    turnover: Decimal


class SalesSummary(BaseModel):
    """Totals over every sale matching a filter, not just the requested page.

    Cancelled sales are excluded throughout: they are money that never happened.
    `turnover` is gross and `refunds` is what came back, so the two reconcile
    with the reports, which headline `net_turnover`.
    """

    turnover: Decimal
    refunds: Decimal
    net_turnover: Decimal
    count: int
    average_check: Decimal
    refund_operations: int
    hourly: List[SalesHourlyBucket]
