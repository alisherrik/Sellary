"""Merchant-facing order management endpoints.

Routes:
  GET    /api/orders            — list incoming orders (filter by status)
  GET    /api/orders/{id}       — order detail
  POST   /api/orders/{id}/confirm  — confirm → create Sale + decrement stock
  POST   /api/orders/{id}/status   — advance status (preparing/ready/etc.)
  POST   /api/orders/{id}/cancel   — reject with reason; voids Sale if exists

All endpoints require a company-scoped access_token with the "shop" module
granted: reads and confirm/status need "user" level, cancel needs "manager".

Resolved Decision #3: confirm does NOT require an open cash shift.
Resolved Decision #4: oversell → 400; order stays pending.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from schemas.order import (
    OrderCancelRequest,
    OrderConfirmRequest,
    OrderListResponse,
    OrderResponse,
    OrderStatusAdvance,
)
from services.order_service import (
    OrderNotFound,
    OrderOversellError,
    OrderService,
    OrderStatusError,
)

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=OrderListResponse)
def list_orders(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    order_status: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("shop")),
):
    """List incoming marketplace orders for the merchant's company."""
    service = OrderService(db, auth.company_id)
    return service.list_orders_for_company(skip=skip, limit=limit, status=order_status)


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("shop")),
):
    service = OrderService(db, auth.company_id)
    order = service.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/{order_id}/confirm", response_model=OrderResponse)
def confirm_order(
    order_id: int,
    payload: OrderConfirmRequest = OrderConfirmRequest(),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("shop")),
):
    """Confirm a pending order: creates a Sale and decrements stock via the FIFO ledger.

    The confirming user's ID is used as the Sale's cashier_id.
    No open cash shift is required (direct SaleService.create, not HTTP /api/sales).
    Returns 400 if stock is insufficient (order stays pending).
    """
    service = OrderService(db, auth.company_id)
    try:
        result = service.confirm(
            order_id,
            cashier_id=auth.user.id,
            payment_method=payload.payment_method,
        )
        db.commit()
        return result
    except OrderNotFound:
        raise HTTPException(status_code=404, detail="Order not found")
    except OrderStatusError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except OrderOversellError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        db.rollback()
        raise


@router.post("/{order_id}/status", response_model=OrderResponse)
def advance_order_status(
    order_id: int,
    payload: OrderStatusAdvance,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("shop")),
):
    """Advance a confirmed order's lifecycle status (preparing → ready → etc.)."""
    service = OrderService(db, auth.company_id)
    try:
        result = service.advance_status(order_id, payload.status)
        db.commit()
        return result
    except OrderNotFound:
        raise HTTPException(status_code=404, detail="Order not found")
    except OrderStatusError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        db.rollback()
        raise


@router.post("/{order_id}/cancel", response_model=OrderResponse)
def cancel_order(
    order_id: int,
    payload: OrderCancelRequest = OrderCancelRequest(),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("shop", "manager")),
):
    """Cancel an order. If a Sale was created (confirmed), voids it to restore stock."""
    service = OrderService(db, auth.company_id)
    try:
        result = service.cancel(
            order_id,
            user_id=auth.user.id,
            reason=payload.reason,
        )
        db.commit()
        return result
    except OrderNotFound:
        raise HTTPException(status_code=404, detail="Order not found")
    except OrderStatusError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception:
        db.rollback()
        raise
