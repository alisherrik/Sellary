"""Contracts for the purchasing reports: what was bought, from whom, at what price."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class PurchaseDayRow(BaseModel):
    day: date
    spend: Decimal
    receipts: int


class PurchaseSummary(BaseModel):
    total_spend: Decimal
    receipts_count: int
    orders_count: int
    suppliers_count: int
    products_count: int
    lines_count: int
    average_receipt: Decimal
    by_day: list[PurchaseDayRow]


class PurchaseByProductRow(BaseModel):
    product_id: int
    name: str
    uom: Optional[str] = None
    quantity: Decimal
    spend: Decimal
    share_percent: Decimal
    average_cost: Decimal
    min_cost: Decimal
    max_cost: Decimal
    # Cost on the first and last delivery inside the period, and the move
    # between them — the direction the price is going, not just its spread.
    first_cost: Optional[Decimal] = None
    last_cost: Optional[Decimal] = None
    cost_change_percent: Optional[Decimal] = None
    current_cost_price: Decimal
    current_sell_price: Decimal
    deliveries: int
    last_received_at: Optional[datetime] = None


class PurchaseBySupplierRow(BaseModel):
    supplier_id: int
    name: str
    spend: Decimal
    share_percent: Decimal
    receipts: int
    products: int
    last_received_at: Optional[datetime] = None


class OutstandingOrderRow(BaseModel):
    order_id: int
    order_date: Optional[datetime] = None
    supplier_name: str
    total_amount: Decimal
    pending_lines: int
