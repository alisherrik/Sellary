"""Shopper-facing order endpoints — POST /api/shop/orders, GET /api/shop/orders.

All endpoints require the Telegram initData header (verified by
get_telegram_shopper). No company-scoped auth — these are public shopper paths.

Idempotency note (Resolved Decision #5):
  POST /api/shop/orders requires an Idempotency-Key header (16-64 chars).
  The idempotency row is scoped as:
    company_id = the first (lowest) company_id among the placed orders
    user_id    = telegram_users.id  (plain integer, not FK-constrained)
    endpoint   = "/api/shop/orders"
  This avoids the FK constraint on idempotency_keys.company_id while still
  providing replay safety per (key, company_id, user_id, endpoint).
  The canonical IdempotencyService is used so that:
    - a reused key with a DIFFERENT cart body returns 409 (not a silent replay);
    - concurrent double-submits are handled safely via DB-level unique flush.
"""
from typing import List

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from api.shop_dependencies import get_telegram_shopper
from core.database import get_db
from core.idempotency import IdempotencyConflictError, IdempotencyService
from models.telegram_user import TelegramUser
from schemas.order import CheckoutRequest, OrderListResponse, OrderResponse
from services.order_service import (
    OrderNotFound,
    OrderService,
)

router = APIRouter(prefix="/shop", tags=["shop-orders"])

_ENDPOINT = "/api/shop/orders"


@router.post("/orders", response_model=List[OrderResponse], status_code=201)
def place_orders(
    request: CheckoutRequest,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=16,
        max_length=64,
    ),
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    """Place one or more per-shop orders from a cart checkout.

    The cart is split client-side into per-shop ``orders`` lists; this endpoint
    receives N order specs in a single call. A UUID ``checkout_group_id`` ties
    them together. Idempotency-Key prevents duplicate orders on retry/double-tap.
    """
    if not request.orders:
        raise HTTPException(status_code=422, detail="orders list must not be empty")

    # Deterministically pick the scoping company_id: lowest company_id in the batch.
    scope_company_id = min(o.company_id for o in request.orders)
    shopper_user_id = shopper.id

    request_dict = request.model_dump(mode="json")
    idempotency_service = IdempotencyService(db)

    # Check idempotency replay using the canonical service.
    # Raises IdempotencyConflictError (→ 409) if same key was used with a different body.
    try:
        cached = idempotency_service.get_cached_response(
            key=idempotency_key,
            company_id=scope_company_id,
            user_id=shopper_user_id,
            endpoint=_ENDPOINT,
            request_body=request_dict,
        )
        if cached is not None:
            # The canonical service stores the body as a dict; we wrapped the list
            # under the "orders" key when storing (see below), so unwrap it here.
            envelope, _ = cached
            return envelope["orders"]
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = OrderService(db)
    try:
        created = service.place_orders(request, telegram_user_id=shopper.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    response_data = [o.model_dump(mode="json") for o in created]

    # Wrap the list in a dict so IdempotencyService (which expects a dict or
    # Pydantic model) can serialize/deserialize it correctly.
    response_envelope = {"orders": response_data}

    # Store idempotency record atomically with the order creation.
    try:
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=scope_company_id,
            user_id=shopper_user_id,
            endpoint=_ENDPOINT,
            request_body=request_dict,
            response_body=response_envelope,
            status_code=201,
        )
        db.commit()
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except Exception:
        db.rollback()
        raise

    return created


@router.get("/orders", response_model=OrderListResponse)
def list_my_orders(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    """Return all orders placed by this shopper (across all shops)."""
    service = OrderService(db)
    return service.list_orders_for_shopper(shopper.id, skip=skip, limit=limit)


@router.get("/orders/{order_id}", response_model=OrderResponse)
def get_my_order(
    order_id: int,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    """Return a single order status (shopper's own orders only)."""
    service = OrderService(db)
    order = service.get_order_for_shopper(order_id, shopper.id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
