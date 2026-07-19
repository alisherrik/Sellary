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
"""
import hashlib
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from api.shop_dependencies import get_telegram_shopper
from core.database import get_db
from models.idempotency_key import IdempotencyKey
from models.telegram_user import TelegramUser
from schemas.order import CheckoutRequest, OrderListResponse, OrderResponse
from services.order_service import (
    OrderNotFound,
    OrderService,
)

router = APIRouter(prefix="/shop", tags=["shop-orders"])

_ENDPOINT = "/api/shop/orders"


def _check_idempotency(
    db: Session,
    key: str,
    request_body: dict,
    company_id: int,
    user_id: int,
) -> Optional[dict]:
    """Return the cached response if the key was seen before, else None."""
    existing = (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.key == key,
            IdempotencyKey.company_id == company_id,
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.endpoint == _ENDPOINT,
        )
        .first()
    )
    if existing and existing.response_body:
        return json.loads(existing.response_body)
    return None


def _store_idempotency(
    db: Session,
    key: str,
    request_body: dict,
    response: list,
    company_id: int,
    user_id: int,
    status_code: int = 201,
) -> None:
    request_hash = hashlib.sha256(
        json.dumps(request_body, sort_keys=True, default=str).encode()
    ).hexdigest()
    idem = IdempotencyKey(
        company_id=company_id,
        key=key,
        user_id=user_id,
        endpoint=_ENDPOINT,
        request_hash=request_hash,
        response_body=json.dumps(response, default=str),
        status_code=status_code,
    )
    db.add(idem)
    db.flush()


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

    # Check idempotency replay.
    request_dict = request.model_dump(mode="json")
    cached = _check_idempotency(
        db, idempotency_key, request_dict, scope_company_id, shopper_user_id
    )
    if cached is not None:
        return cached

    service = OrderService(db)
    try:
        created = service.place_orders(request, telegram_user_id=shopper.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    response_data = [o.model_dump(mode="json") for o in created]

    # Store idempotency record so a retry returns the same response.
    try:
        _store_idempotency(
            db, idempotency_key, request_dict, response_data, scope_company_id, shopper_user_id
        )
        db.commit()
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
