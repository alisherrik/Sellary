from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
from core.database import get_db
from core.state_machine import StateTransitionError
from core.idempotency import (
    IdempotencyService,
    IdempotencyConflictError,
    require_idempotency_key,
)
from schemas.sale import SaleCreate, SaleResponse, SaleContextType
from schemas.sale_return import SaleReturnCreate, SaleReturnResponse
from services.sale_service import SaleService
from services.sale_return_service import SaleReturnService
from api.dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/sales", tags=["sales"])


@router.post("", response_model=SaleResponse, status_code=201)
def create_sale(
    sale_create: SaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    idempotency_key: str = Depends(require_idempotency_key),
):
    """
    Create a new sale (idempotent).
    
    Requires Idempotency-Key header. Repeated requests with the same key
    will return the original response without re-processing.
    """
    endpoint = "/api/sales"
    request_body = sale_create.dict()
    
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
            # Return cached response (already processed)
            return SaleResponse(**response_body)
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    
    # Process the request
    service = SaleService(db)
    try:
        result = service.create(sale_create, current_user.id)
        
        # Store idempotency record (before final commit happens in service)
        idempotency_service.store_response(
            key=idempotency_key,
            user_id=current_user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=201,
        )
        
        return result
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=list[SaleResponse])
def get_sales(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    cashier_id: Optional[int] = None,
    context_type: Optional[SaleContextType] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SaleService(db)
    sales, _ = service.get_all(
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        cashier_id=cashier_id,
        context_type=context_type,
    )
    return sales


@router.get("/{sale_id}", response_model=SaleResponse)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SaleService(db)
    sale = service.get_by_id(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.post("/{sale_id}/cancel", response_model=SaleResponse)
def cancel_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
            return SaleResponse(**response_body)
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    
    # Process the request
    service = SaleService(db)
    try:
        result = service.cancel(sale_id, current_user.id)
        
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


@router.post("/{sale_id}/return", response_model=SaleReturnResponse, status_code=201)
def return_sale(
    sale_id: int,
    return_data: SaleReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    request_body = return_data.dict()
    request_body["sale_id"] = sale_id
    
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
            return SaleReturnResponse(**response_body)
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    
    # Process the return
    service = SaleReturnService(db)
    try:
        result = service.process_return(sale_id, return_data, current_user.id)
        
        # Store idempotency record
        idempotency_service.store_response(
            key=idempotency_key,
            user_id=current_user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=201,
        )
        
        return result
    except IdempotencyConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except StateTransitionError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{sale_id}/returns", response_model=list[SaleReturnResponse])
def get_sale_returns(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all returns for a specific sale.
    """
    service = SaleReturnService(db)
    return service.get_returns_for_sale(sale_id)


