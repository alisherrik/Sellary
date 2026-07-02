from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context, require_admin
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from core.state_machine import StateTransitionError
from schemas.reversal import VoidPreview, VoidRequest, VoidResult
from schemas.sale import SaleCreate, SaleResponse, SaleSearchSuggestion, SaleStatus
from schemas.sale_return import SaleReturnCreate, SaleReturnResponse
from services.sale_return_service import SaleReturnService
from services.sale_service import SaleService
from services.transaction_reversal_service import (
    ReversalBlocked,
    ReversalConflict,
    TransactionReversalService,
)

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
    search: Optional[str] = Query(None, max_length=100),
    status_group: Optional[Literal["returns"]] = None,
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
        search=search.strip() if search else None,
        status_group=status_group,
    )
    return sales


@router.get("/search-suggestions", response_model=list[SaleSearchSuggestion])
def get_sale_search_suggestions(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(8, ge=1, le=10),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    return SaleService(db, auth.company_id).get_search_suggestions(q.strip(), limit)


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


@router.get("/{sale_id}/void-preview", response_model=VoidPreview)
def preview_sale_void(
    sale_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    """Preview the inventory impact of annulling a sale (admin only).

    Pure dry-run: computes the outstanding quantity/value that would be
    restored without mutating anything. Returns HTTP 404 if the sale does not
    exist.
    """
    service = TransactionReversalService(db, auth.company_id)
    try:
        return service.preview_sale(sale_id)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/{sale_id}/void", response_model=VoidResult)
def void_sale(
    sale_id: int,
    payload: VoidRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """Annul (void) a completed sale (admin only, idempotent).

    Reverses the sale's effect on the FIFO inventory ledger — restoring only
    the outstanding quantity (sold minus already-returned) — records an
    immutable ReversalOperation, and flips the sale into the terminal
    CANCELLED state with void audit metadata.

    Requires an Idempotency-Key header; repeated requests with the same key
    replay the original response. Returns HTTP 409 if the sale is already
    annulled / in a conflicting lifecycle state, or the key was reused with a
    different body; HTTP 400 for invalid input.
    """
    endpoint = f"/api/sales/{sale_id}/void"
    request_body = payload.model_dump()

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
            return VoidResult(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = TransactionReversalService(db, auth.company_id)
    try:
        result = service.void_sale(sale_id, payload.reason, auth.user.id)
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
    except ReversalBlocked as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.to_response())
    except (IdempotencyConflictError, ReversalConflict, StateTransitionError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/{sale_id}/cancel", response_model=VoidResult, deprecated=True)
def cancel_sale(
    sale_id: int,
    payload: VoidRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """DEPRECATED — use ``POST /sales/{id}/void`` instead.

    Kept for one compatibility release. Now admin-only and requires a
    ``{"reason": ...}`` body; routes through the same annulment service as
    ``/void`` so the FIFO ledger allocations are released (no direct stock
    bump). Cashiers and managers can no longer cancel sales.
    """
    endpoint = f"/api/sales/{sale_id}/cancel"
    request_body = payload.model_dump()

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
            return VoidResult(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = TransactionReversalService(db, auth.company_id)
    try:
        result = service.void_sale(sale_id, payload.reason, auth.user.id)
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
    except ReversalBlocked as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.to_response())
    except (IdempotencyConflictError, ReversalConflict, StateTransitionError) as exc:
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
