from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from models.cash_shift import CashShift as CashShiftModel, CashShiftStatus
from schemas.cash_shift import (
    CashShift,
    CashShiftDetail,
    ShiftClose,
    ShiftOpen,
    ShiftSnapshotResponse,
    ShiftTotals,
)
from services.cash_shift_service import CashShiftService, ShiftConflict

router = APIRouter(prefix="/shifts", tags=["shifts"])


def _to_response(service: CashShiftService, shift: CashShiftModel) -> CashShift:
    return CashShift(
        id=shift.id,
        shift_number=shift.shift_number,
        status=shift.status.value if hasattr(shift.status, "value") else shift.status,
        opened_at=shift.opened_at,
        opened_by_user_id=shift.opened_by_user_id,
        opening_cash=shift.opening_cash,
        closed_at=shift.closed_at,
        closed_by_user_id=shift.closed_by_user_id,
        counted_cash=shift.counted_cash,
        expected_cash=shift.expected_cash,
        discrepancy=shift.discrepancy,
        notes=shift.notes,
        totals=service.totals_for(shift),
    )


# Must stay above /{shift_id}: that route parses the segment as an int, so
# /shifts/current would 422 instead of reaching this handler.
@router.get("/current", response_model=Optional[CashShift])
def get_current_shift(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("pos")),
):
    """The company's open shift with live totals, or null if none is open."""
    service = CashShiftService(db, auth.company_id)
    shift = service.get_current()
    return _to_response(service, shift) if shift else None


@router.post("/open", response_model=CashShift, status_code=201)
def open_shift(
    body: ShiftOpen,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("pos")),
):
    service = CashShiftService(db, auth.company_id)
    try:
        shift = service.open_shift(body.opening_cash, auth.user.id)
    except ShiftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    db.refresh(shift)
    return _to_response(service, shift)


@router.post("/{shift_id}/close", response_model=CashShift)
def close_shift(
    shift_id: int,
    body: ShiftClose,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("pos")),
):
    service = CashShiftService(db, auth.company_id)
    try:
        shift = service.close_shift(shift_id, body.counted_cash, body.notes, auth.user.id)
    except ShiftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    db.refresh(shift)
    return _to_response(service, shift)


@router.post("/{shift_id}/snapshots", response_model=ShiftSnapshotResponse, status_code=201)
def take_snapshot(
    shift_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("pos")),
):
    """Save an X-report — the till breakdown right now, without closing."""
    service = CashShiftService(db, auth.company_id)
    try:
        snapshot = service.take_snapshot(shift_id, auth.user.id)
    except ShiftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    db.refresh(snapshot)
    return ShiftSnapshotResponse(
        id=snapshot.id,
        taken_at=snapshot.taken_at,
        taken_by_user_id=snapshot.taken_by_user_id,
        totals=ShiftTotals.model_validate(snapshot.totals),
    )


@router.get("", response_model=list[CashShift])
def list_shifts(
    response: Response,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("pos")),
):
    service = CashShiftService(db, auth.company_id)
    query = db.query(CashShiftModel).filter(CashShiftModel.company_id == auth.company_id)
    if start_date:
        query = query.filter(CashShiftModel.opened_at >= start_date)
    if end_date:
        query = query.filter(CashShiftModel.opened_at <= end_date)
    total = query.count()
    shifts = query.order_by(CashShiftModel.opened_at.desc()).offset(skip).limit(limit).all()
    response.headers["X-Total-Count"] = str(total)
    return [_to_response(service, shift) for shift in shifts]


@router.get("/{shift_id}", response_model=CashShiftDetail)
def get_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("pos")),
):
    service = CashShiftService(db, auth.company_id)
    shift = (
        db.query(CashShiftModel)
        .filter(CashShiftModel.company_id == auth.company_id, CashShiftModel.id == shift_id)
        .first()
    )
    if shift is None:
        raise HTTPException(status_code=404, detail="Смена не найдена")

    base = _to_response(service, shift)
    return CashShiftDetail(
        **base.model_dump(),
        snapshots=[
            ShiftSnapshotResponse(
                id=snap.id,
                taken_at=snap.taken_at,
                taken_by_user_id=snap.taken_by_user_id,
                totals=ShiftTotals.model_validate(snap.totals),
            )
            for snap in shift.snapshots
        ],
    )
