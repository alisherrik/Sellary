from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from schemas.category import Category


class SyncProductItem(BaseModel):
    id: int
    barcode: Optional[str]
    name: str
    uom: str
    category_id: Optional[int]
    sell_price: Decimal
    tax_percent: Decimal
    stock_quantity: Decimal
    is_active: bool
    updated_at: datetime


class SyncCustomerItem(BaseModel):
    id: int
    client_customer_id: Optional[str] = None
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    description: Optional[str] = None
    balance: Decimal = Decimal("0.00")
    is_active: bool


class SyncBootstrapResponse(BaseModel):
    company_id: int
    company_name: str
    user_id: int
    user_username: str
    user_role: str
    server_time: datetime
    products: list[SyncProductItem]
    categories: list[Category]
    customers: list[SyncCustomerItem] = []


class SyncSaleItemCreate(BaseModel):
    product_id: int
    quantity: Decimal = Field(..., gt=0, decimal_places=3)
    sell_price: Decimal


class SyncSaleCreate(BaseModel):
    client_sale_id: str
    idempotency_key: str
    created_at_client: datetime
    payment_method: str
    card_type: Optional[str] = None
    discount_amount: Decimal = Decimal("0")
    paid_amount: Decimal
    change_amount: Decimal = Decimal("0")
    notes: Optional[str] = None
    items: list[SyncSaleItemCreate]


class SyncSalesRequest(BaseModel):
    sales: list[SyncSaleCreate]


class SyncWarning(BaseModel):
    type: str
    product_id: int
    product_name: str
    requested: Decimal
    available: Decimal
    new_balance: Decimal


class SyncSaleResult(BaseModel):
    client_sale_id: str
    status: str
    sale_id: Optional[int] = None
    warnings: Optional[list[SyncWarning]] = None
    error: Optional[str] = None


class SyncSalesResponse(BaseModel):
    results: list[SyncSaleResult]


class SyncCustomerCreate(BaseModel):
    client_customer_id: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    description: Optional[str] = None


class SyncCustomersRequest(BaseModel):
    customers: list[SyncCustomerCreate]


class SyncCustomerResult(BaseModel):
    client_customer_id: str
    status: str
    server_id: Optional[int] = None
    error: Optional[str] = None


class SyncCustomersResponse(BaseModel):
    results: list[SyncCustomerResult]


class SyncPaymentWarning(BaseModel):
    type: str
    requested: Decimal
    applied: Decimal


class SyncPaymentCreate(BaseModel):
    client_payment_id: str
    idempotency_key: str
    client_customer_id: str
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: str
    description: Optional[str] = None


class SyncPaymentsRequest(BaseModel):
    payments: list[SyncPaymentCreate]


class SyncPaymentResult(BaseModel):
    client_payment_id: str
    status: str
    applied_amount: Decimal = Decimal("0.00")
    warnings: Optional[list[SyncPaymentWarning]] = None
    error: Optional[str] = None


class SyncPaymentsResponse(BaseModel):
    results: list[SyncPaymentResult]
