from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context, require_manager_or_admin
from core.database import get_db
from schemas.company import MarketplaceSettingsResponse, MarketplaceSettingsUpdate
from services.company_service import CompanyService

router = APIRouter(prefix="/company", tags=["company"])


@router.get("/marketplace", response_model=MarketplaceSettingsResponse)
def get_marketplace_settings(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    return CompanyService(db, auth.company_id).get_marketplace_settings()


@router.patch("/marketplace", response_model=MarketplaceSettingsResponse)
def update_marketplace_settings(
    payload: MarketplaceSettingsUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = CompanyService(db, auth.company_id)
    try:
        response = service.update_marketplace_settings(payload)
        db.commit()
        return response
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        db.rollback()
        raise
