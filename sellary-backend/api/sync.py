from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from schemas.sync import (
    SyncBootstrapResponse,
    SyncCustomersRequest,
    SyncCustomersResponse,
    SyncPaymentsRequest,
    SyncPaymentsResponse,
    SyncSalesRequest,
    SyncSalesResponse,
)
from services.customer_sync_service import CustomerSyncService
from services.sync_service import SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/bootstrap", response_model=SyncBootstrapResponse)
def bootstrap(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = SyncService(db)
    return service.bootstrap(auth.company, auth.user)


@router.post("/sales", response_model=SyncSalesResponse)
def sync_sales(
    request: SyncSalesRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = SyncService(db)
    try:
        result = service.sync_sales(auth.company, auth.user, request)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/customers", response_model=SyncCustomersResponse)
def sync_customers(
    request: SyncCustomersRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = CustomerSyncService(db)
    try:
        result = service.sync_customers(auth.company, auth.user, request)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/payments", response_model=SyncPaymentsResponse)
def sync_payments(
    request: SyncPaymentsRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = CustomerSyncService(db)
    try:
        result = service.sync_payments(auth.company, auth.user, request)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
