from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from schemas.inventory_log import InventoryAdjustment, InventoryLog
from services.inventory_service import InventoryService

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.post("/adjust")
def adjust_stock(
    adjustment: InventoryAdjustment,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory", "manager")),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = "/api/inventory/adjust"
    request_body = adjustment.model_dump()

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
            return response_body
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = InventoryService(db, auth.company_id)
    try:
        result = service.adjust_stock(adjustment, auth.user.id)
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
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/logs", response_model=list[InventoryLog])
def get_inventory_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    product_id: Optional[int] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = InventoryService(db, auth.company_id)
    logs, _ = service.get_logs(skip=skip, limit=limit, product_id=product_id)
    return logs


@router.get("/valuation")
def get_inventory_valuation(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = InventoryService(db, auth.company_id)
    return service.get_inventory_value()
