from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from core.database import get_db
from core.state_machine import StateTransitionError
from core.idempotency import (
    IdempotencyService,
    IdempotencyConflictError,
    require_idempotency_key,
)
from schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderUpdate,
    PurchaseOrderResponse,
    ReceiveItemsRequest,
    PurchaseOrderStatus,
)
from services.purchase_order_service import PurchaseOrderService
from api.dependencies import get_current_user, require_manager_or_admin
from models.user import User

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
    current_user: User = Depends(get_current_user),
):
    service = PurchaseOrderService(db)
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
    current_user: User = Depends(get_current_user),
):
    service = PurchaseOrderService(db)
    po = service.get_by_id(po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


@router.post("", response_model=PurchaseOrderResponse, status_code=201)
def create_purchase_order(
    po_create: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = PurchaseOrderService(db)
    try:
        return service.create(po_create)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{po_id}", response_model=PurchaseOrderResponse)
def update_purchase_order(
    po_id: int,
    po_update: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    Update a draft purchase order.
    
    Returns HTTP 409 Conflict if the PO is not in DRAFT status.
    """
    service = PurchaseOrderService(db)
    try:
        return service.update(po_id, po_update)
    except StateTransitionError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{po_id}/send", response_model=PurchaseOrderResponse)
def send_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    Mark a draft purchase order as sent.
    
    Returns HTTP 409 Conflict if the PO is not in DRAFT status.
    """
    service = PurchaseOrderService(db)
    try:
        return service.send(po_id)
    except StateTransitionError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{po_id}/receive", response_model=PurchaseOrderResponse)
def receive_items(
    po_id: int,
    receive_request: ReceiveItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """
    Receive items from a purchase order (idempotent).
    
    Requires Idempotency-Key header. Allowed only for SENT or PARTIALLY_RECEIVED orders.
    Returns HTTP 409 Conflict if the PO is RECEIVED, CANCELLED, or key was reused.
    """
    endpoint = f"/api/purchase-orders/{po_id}/receive"
    request_body = receive_request.dict()
    
    # Check for cached response
    idempotency_service = IdempotencyService(db)
    try:
        cached = idempotency_service.get_cached_response(
            key=idempotency_key,
            user_id=current_user.id,
            endpoint=endpoint,
            request_body=request_body,
        )
        if cached:
            response_body, status_code = cached
            return PurchaseOrderResponse(**response_body)
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    
    service = PurchaseOrderService(db)
    try:
        result = service.receive_items(po_id, receive_request, current_user.id)
        
        # Store idempotency record
        idempotency_service.store_response(
            key=idempotency_key,
            user_id=current_user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=200,
        )
        
        return result
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except StateTransitionError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{po_id}/cancel", response_model=PurchaseOrderResponse)
def cancel_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    Cancel a purchase order.
    
    Allowed for DRAFT, SENT, or PARTIALLY_RECEIVED orders.
    Returns HTTP 409 Conflict if the PO is RECEIVED or already CANCELLED.
    """
    service = PurchaseOrderService(db)
    try:
        return service.cancel(po_id)
    except StateTransitionError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{po_id}", status_code=204)
def delete_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    Delete a draft purchase order.
    
    Returns HTTP 409 Conflict if the PO is not in DRAFT status.
    """
    service = PurchaseOrderService(db)
    try:
        service.delete(po_id)
    except StateTransitionError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
