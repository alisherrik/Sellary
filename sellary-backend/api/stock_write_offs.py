from datetime import datetime
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
from schemas.stock_write_off import (
    WriteOffCreate,
    WriteOffListResponse,
    WriteOffRead,
    WriteOffSummary,
)
from services.report_service import ReportService
from services.stock_write_off_service import StockWriteOffService

router = APIRouter(prefix="/write-offs", tags=["write-offs"])


def _to_read(write_off) -> dict:
    return {
        "id": write_off.id,
        "disposition": write_off.disposition,
        "reason_code": write_off.reason_code,
        "supplier_id": write_off.supplier_id,
        "supplier_name": write_off.supplier.name if write_off.supplier else None,
        "notes": write_off.notes,
        "total_cost": write_off.total_cost,
        "created_by_user_id": write_off.created_by_user_id,
        "created_by_name": (
            (write_off.created_by_user.full_name or write_off.created_by_user.username)
            if write_off.created_by_user
            else None
        ),
        "created_at": write_off.created_at,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name": item.product.name if item.product else "",
                "product_unit_id": item.product_unit_id,
                "unit_name": item.product_unit.name if item.product_unit else None,
                "unit_quantity": item.unit_quantity,
                "quantity": item.quantity,
                "unit_cost": item.unit_cost,
                "line_cost": item.line_cost,
            }
            for item in write_off.items
        ],
    }


@router.post("", response_model=WriteOffRead)
def create_write_off(
    payload: WriteOffCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory", "manager")),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = "/api/write-offs"
    request_body = payload.model_dump(mode="json")

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

    service = StockWriteOffService(db, auth.company_id)
    try:
        write_off = service.create(payload, auth.user.id)
        result = WriteOffRead(**_to_read(write_off))
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result.model_dump(mode="json"),
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


@router.get("", response_model=WriteOffListResponse)
def list_write_offs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    disposition: Optional[str] = Query(None),
    reason_code: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = StockWriteOffService(db, auth.company_id)
    rows, total = service.list(
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        disposition=disposition,
        reason_code=reason_code,
        supplier_id=supplier_id,
    )
    return {"items": [_to_read(row) for row in rows], "total": total}


# Declared before /{write_off_id}: otherwise FastAPI reads "summary" as an id.
@router.get("/summary", response_model=WriteOffSummary)
def get_write_off_summary(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    start, end = ReportService(db, auth.company_id).default_range(
        start_date, end_date, days
    )
    data = StockWriteOffService(db, auth.company_id).summary(start, end)
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        **data,
    }


@router.get("/{write_off_id}", response_model=WriteOffRead)
def get_write_off(
    write_off_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = StockWriteOffService(db, auth.company_id)
    write_off = service.get(write_off_id)
    if not write_off:
        raise HTTPException(status_code=404, detail="Write-off not found")
    return _to_read(write_off)
