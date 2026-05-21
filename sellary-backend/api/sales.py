from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from core.state_machine import StateTransitionError
from schemas.sale import SaleContextType, SaleCreate, SaleResponse, SaleStatus
from schemas.sale_return import SaleReturnCreate, SaleReturnResponse
from services.sale_return_service import SaleReturnService
from services.sale_service import SaleService

router = APIRouter(prefix="/sales", tags=["sales"])


@router.post("", response_model=SaleResponse, status_code=201)
def create_sale(
    sale_create: SaleCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """
    Create a new sale (idempotent).

    Requires Idempotency-Key header. Repeated requests with the same key
    will return the original response without re-processing.
    """
    endpoint = "/api/sales"
    request_body = sale_create.model_dump()

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
            return SaleResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = SaleService(db, auth.company_id)
    try:
        result = service.create(sale_create, auth.user.id)
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=201,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=list[SaleResponse])
def get_sales(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    cashier_id: Optional[int] = None,
    status: Optional[SaleStatus] = None,
    context_type: Optional[SaleContextType] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = SaleService(db, auth.company_id)
    sales, _ = service.get_all(
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        cashier_id=cashier_id,
        status=status,
        context_type=context_type,
    )
    return sales


@router.get("/{sale_id}", response_model=SaleResponse)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = SaleService(db, auth.company_id)
    sale = service.get_by_id(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.post("/{sale_id}/cancel", response_model=SaleResponse)
def cancel_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """
    Cancel a completed sale (idempotent).

    Requires Idempotency-Key header. Returns HTTP 409 Conflict if:
    - The sale cannot be cancelled (already cancelled/returned)
    - The idempotency key was used with a different request
    """
    endpoint = f"/api/sales/{sale_id}/cancel"
    request_body = {"sale_id": sale_id}

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
            return SaleResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = SaleService(db, auth.company_id)
    try:
        result = service.cancel(sale_id, auth.user.id)
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


@router.post("/{sale_id}/return", response_model=SaleReturnResponse, status_code=201)
def return_sale(
    sale_id: int,
    return_data: SaleReturnCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """
    Process a sale return/refund (idempotent).

    Supports partial returns (some items) and full returns (all items).
    Requires Idempotency-Key header.

    Returns HTTP 409 Conflict if:
    - The sale cannot be returned (already fully returned or cancelled)
    - The idempotency key was used with a different request
    """
    endpoint = f"/api/sales/{sale_id}/return"
    request_body = return_data.model_dump()
    request_body["sale_id"] = sale_id

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
            return SaleReturnResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = SaleReturnService(db, auth.company_id)
    try:
        result = service.process_return(sale_id, return_data, auth.user.id)
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=201,
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


@router.get("/{sale_id}/returns", response_model=list[SaleReturnResponse])
def get_sale_returns(
    sale_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    """
    Get all returns for a specific sale.
    """
    service = SaleReturnService(db, auth.company_id)
    return service.get_returns_for_sale(sale_id)
