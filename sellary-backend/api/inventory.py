from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from core.database import get_db
from core.idempotency import (
    IdempotencyService,
    IdempotencyConflictError,
    require_idempotency_key,
)
from schemas.inventory_log import InventoryAdjustment, InventoryLog
from services.inventory_service import InventoryService
from api.dependencies import get_current_user, require_manager_or_admin
from models.user import User

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.post("/adjust")
def adjust_stock(
    adjustment: InventoryAdjustment,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """
    Manually adjust inventory stock (idempotent).
    
    Requires Idempotency-Key header. Repeated requests with the same key
    will return the original response without re-processing.
    """
    endpoint = "/api/inventory/adjust"
    request_body = adjustment.dict()
    
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
            return response_body
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    
    service = InventoryService(db)
    try:
        result = service.adjust_stock(adjustment, current_user.id)
        
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/logs", response_model=list[InventoryLog])
def get_inventory_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    product_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = InventoryService(db)
    logs, _ = service.get_logs(skip=skip, limit=limit, product_id=product_id)
    return logs


@router.get("/valuation")
def get_inventory_valuation(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = InventoryService(db)
    return service.get_inventory_value()
