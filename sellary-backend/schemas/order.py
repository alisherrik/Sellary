"""Order domain Pydantic schemas.

Two surfaces:
  - Shopper-facing (POST /api/shop/orders, GET /api/shop/orders): ``OrderCreate``,
    ``OrderItemCreate``, ``OrderResponse``, ``OrderListResponse``.
  - Merchant-facing (GET/POST /api/orders/*): same response shape; separate
    status-advance and confirm payloads.

Price/name are snapshotted on creation; the response echoes the snapshot so the
shopper and merchant always see the agreed amounts regardless of later product
edits.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class OrderItemCreate(BaseModel):
    product_id: int
    quantity: Decimal = Field(..., gt=0, decimal_places=3)
    # unit_price is taken from the published catalog at request time (server
    # resolves it) — the client sends it as a confirmation so the server can
    # reject stale prices if needed. For MVP we accept client-supplied price
    # but validate it matches the published product price.
    unit_price: Decimal = Field(..., ge=0, decimal_places=4)


class OrderCreate(BaseModel):
    """Payload for POST /api/shop/orders.

    A single checkout posts ONE OrderCreate per shop (items are already split
    client-side). The shopper may share their phone here for the first time.
    """

    company_id: int
    items: List[OrderItemCreate] = Field(..., min_length=1)
    fulfillment_type: str = Field(..., pattern="^(delivery|pickup)$")
    delivery_address: Optional[str] = Field(None, max_length=500)
    contact_phone: str = Field(..., min_length=7, max_length=32)
    contact_name: str = Field(..., min_length=1, max_length=150)
    notes: Optional[str] = Field(None, max_length=1000)
    checkout_group_id: Optional[str] = Field(None, max_length=36)


class CheckoutRequest(BaseModel):
    """Body for POST /api/shop/orders — one or more per-shop order specs."""

    orders: List[OrderCreate] = Field(..., min_length=1)


class OrderItemResponse(BaseModel):
    id: int
    product_id: Optional[int]
    product_name: str
    unit_price: Decimal
    quantity: Decimal
    line_total: Decimal

    class Config:
        from_attributes = True


class OrderResponse(BaseModel):
    id: int
    company_id: int
    order_number: int
    status: str
    fulfillment_type: str
    delivery_address: Optional[str]
    contact_phone: str
    contact_name: str
    subtotal: Decimal
    total_amount: Decimal
    notes: Optional[str]
    sale_id: Optional[int]
    checkout_group_id: Optional[str]
    created_at: datetime
    updated_at: datetime
    items: List[OrderItemResponse]

    class Config:
        from_attributes = True


class OrderListResponse(BaseModel):
    items: List[OrderResponse]
    total: int
    skip: int
    limit: int


class OrderStatusAdvance(BaseModel):
    """Payload for POST /api/orders/{id}/status (merchant advances lifecycle)."""

    status: str = Field(
        ...,
        pattern="^(preparing|ready|delivering|completed)$",
    )


class OrderCancelRequest(BaseModel):
    """Payload for POST /api/orders/{id}/cancel."""

    reason: Optional[str] = Field(None, max_length=500)


class OrderConfirmRequest(BaseModel):
    """Payload for POST /api/orders/{id}/confirm (merchant confirms → creates Sale)."""

    # Payment method for the sale created on confirm. Defaults to cash (MVP).
    payment_method: str = Field(default="cash", pattern="^(cash|card|mobile)$")
