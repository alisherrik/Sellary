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
import dataclasses
import logging
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from api.shop_dependencies import get_telegram_shopper
from core.database import get_db
from core.idempotency import IdempotencyConflictError, IdempotencyService
from models.telegram_user import TelegramUser
from schemas.order import CheckoutRequest, OrderListResponse, OrderResponse
from services.merchant_notify_service import MerchantNotifyService
from services.order_service import (
    OrderNotFound,
    OrderService,
)
from services.platform_settings_service import PlatformSettingsService

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/shop", tags=["shop-orders"])

_ENDPOINT = "/api/shop/orders"


@dataclasses.dataclass
class _NotifyPayload:
    """Plain data snapshot gathered while the request session is still open.

    Holds everything needed to build and send the Telegram notification without
    touching the database again — so the deferred background task is DB-free and
    safe to run after the request session is closed.
    """
    company_id: int
    chat_ids: list
    message: str
    bot_token: str


def _send_notify(payload: _NotifyPayload) -> None:
    """Background task: network-only Telegram send, no DB access.

    All data was gathered inline (while the request session was open) and
    serialised into a plain-data ``_NotifyPayload``.  A failure here is
    best-effort: swallowed and logged so order placement is never affected.
    """
    from core.config import settings
    from services.telegram_bot_client import TelegramBotClient

    try:
        bot = TelegramBotClient(
            bot_token=payload.bot_token,
            base_url=settings.TELEGRAM_API_BASE_URL,
        )
        for chat_id in payload.chat_ids:
            try:
                bot.send_message(chat_id, payload.message)
            except Exception:
                _log.warning(
                    "post-order notify send failed company=%s chat=%s",
                    payload.company_id,
                    chat_id,
                    exc_info=True,
                )
    except Exception:
        _log.exception(
            "post-order notify send failed company=%s", payload.company_id
        )


@router.post("/orders", response_model=List[OrderResponse], status_code=201)
def place_orders(
    request: CheckoutRequest,
    background_tasks: BackgroundTasks,
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

    # Gather notification payloads INLINE while the request session is still open.
    # The deferred background task (_send_notify) performs ONLY the Telegram HTTP
    # call — it never touches the DB — so it is safe even after the session closes.
    notify_service = MerchantNotifyService(db)
    resolved_bot_token = PlatformSettingsService(db).resolve("telegram_bot_token")
    for order_resp in created:
        try:
            notify_data = notify_service.build_notify_payload(order_resp.id)
            if notify_data is not None:
                company_id, chat_ids, message = notify_data
                background_tasks.add_task(
                    _send_notify,
                    _NotifyPayload(
                        company_id=company_id,
                        chat_ids=chat_ids,
                        message=message,
                        bot_token=resolved_bot_token,
                    ),
                )
        except Exception:
            _log.exception(
                "post-order notify gather failed order=%s", order_resp.id
            )

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
