from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_admin, require_manager_or_admin
from core.database import get_db
from schemas.consistency import ConsistencyReport, FindingOut
from schemas.reconciliation import (
    ReconciliationCreate,
    ReconciliationRead,
    ReconciliationState,
)
from services.company_time import utc_now
from services.reconciliation import ReconciliationBlocked
from services.reconciliation_service import ReconciliationService

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])


@router.get("", response_model=ReconciliationState)
def get_reconciliation(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = ReconciliationService(db, auth.company_id)
    return ReconciliationState(latest=service.latest(), history=service.history())


@router.get("/check", response_model=ConsistencyReport)
def check_consistency(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    findings = ReconciliationService(db, auth.company_id).check()
    return ConsistencyReport(
        checked_at=utc_now(),
        clean=not any(finding.bucket == "drift" for finding in findings),
        findings=[FindingOut(**finding.__dict__) for finding in findings],
    )


@router.post("", response_model=ReconciliationRead, status_code=201)
def create_reconciliation(
    payload: ReconciliationCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    # A reconciliation spans stock and cash, so it is an admin act rather than
    # a module one.
    service = ReconciliationService(db, auth.company_id)
    try:
        row = service.create(
            effective_from=payload.effective_from,
            note=payload.note,
            user_id=auth.user.id,
            acknowledge_violations=payload.acknowledge_violations,
        )
        db.commit()
        return row
    except ReconciliationBlocked as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "findings": [FindingOut(**finding.__dict__).model_dump() for finding in exc.findings],
            },
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception:
        db.rollback()
        raise
