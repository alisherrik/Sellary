from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context, require_manager_or_admin
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from core.state_machine import StateTransitionError
from schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderResponse,
    PurchaseOrderStatus,
    PurchaseOrderUpdate,
    ReceiveItemsRequest,
)
from services.purchase_order_service import PurchaseOrderService

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])


@router.get("", response_model=list[PurchaseOrderResponse])
def get_purchase_orders(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    supplier_id: Optional[int] = None,
    status: Optional[PurchaseOrderStatus] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = PurchaseOrderService(db, auth.company_id)
    purchase_orders, _ = service.get_all(
        skip=skip,
        limit=limit,
        supplier_id=supplier_id,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )
    return purchase_orders


@router.get("/{po_id}", response_model=PurchaseOrderResponse)
def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = PurchaseOrderService(db, auth.company_id)
    purchase_order = service.get_by_id(po_id)
    if not purchase_order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return purchase_order


@router.post("", response_model=PurchaseOrderResponse, status_code=201)
def create_purchase_order(
    po_create: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = PurchaseOrderService(db, auth.company_id)
    try:
        return service.create(po_create)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{po_id}", response_model=PurchaseOrderResponse)
def update_purchase_order(
    po_id: int,
    po_update: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = PurchaseOrderService(db, auth.company_id)
    try:
        return service.update(po_id, po_update)
    except StateTransitionError as exc:
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/{po_id}/send", response_model=PurchaseOrderResponse)
def send_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = f"/api/purchase-orders/{po_id}/send"
    request_body = {"po_id": po_id}

    idempotency_service = IdempotencyService(db)
    try:
        cached = idempotency_service.get_cached_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
        )
        if cached:
            response_body, _ = cached
            return PurchaseOrderResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = PurchaseOrderService(db, auth.company_id)
    try:
        result = service.send(po_id)
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=200,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except StateTransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/{po_id}/cancel", response_model=PurchaseOrderResponse)
def cancel_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = f"/api/purchase-orders/{po_id}/cancel"
    request_body = {"po_id": po_id}

    idempotency_service = IdempotencyService(db)
    try:
        cached = idempotency_service.get_cached_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
        )
        if cached:
            response_body, _ = cached
            return PurchaseOrderResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = PurchaseOrderService(db, auth.company_id)
    try:
        result = service.cancel(po_id)
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=200,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except StateTransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/{po_id}/receive", response_model=PurchaseOrderResponse)
def receive_items(
    po_id: int,
    receive_request: ReceiveItemsRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = f"/api/purchase-orders/{po_id}/receive"
    request_body = receive_request.model_dump()

    idempotency_service = IdempotencyService(db)
    try:
        cached = idempotency_service.get_cached_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
        )
        if cached:
            response_body, _ = cached
            return PurchaseOrderResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = PurchaseOrderService(db, auth.company_id)
    try:
        result = service.receive_items(po_id, receive_request, auth.user.id)
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=200,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except StateTransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/{po_id}/cancel", response_model=PurchaseOrderResponse)
def cancel_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = PurchaseOrderService(db, auth.company_id)
    try:
        return service.cancel(po_id)
    except StateTransitionError as exc:
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.delete("/{po_id}", status_code=204)
def delete_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = PurchaseOrderService(db, auth.company_id)
    try:
        service.delete(po_id)
    except StateTransitionError as exc:
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
