from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from core.idempotency import IdempotencyConflictError
from schemas.sync import SyncBootstrapResponse, SyncSalesRequest, SyncSalesResponse
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
