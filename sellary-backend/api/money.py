"""Money accounts: where the shop's money is, and every time it moves.

Reading balances is `finance:user`; recording anything is `finance:manager`.
Till movements from the shift page go through `POST /money/till` instead, which
asks for `register:manager` — the cashier closing the drawer is the one who
writes down that 150 went out for a delivery.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from models.money_account import IN_REASONS, OUT_REASONS
from schemas.money import (
    BalanceCorrection,
    MoneyAccountCreate,
    MoneyAccountOut,
    MoneyAccountUpdate,
    MoneyOverview,
    MovementCreate,
    MovementOut,
    TransferCreate,
)
from services.money_service import REASON_LABELS, MoneyError, MoneyService

router = APIRouter(prefix="/money", tags=["money"])


@router.get("/reasons")
def list_reasons(auth: AuthContext = Depends(require_module("finance", "user"))):
    """The closed list of movement reasons, with their Russian labels.

    Sent rather than duplicated in the frontend so the two cannot drift into
    showing different words for the same stored value.
    """
    return {
        "in": [{"value": r, "label": REASON_LABELS[r]} for r in IN_REASONS if r != "transfer_in"],
        "out": [
            {"value": r, "label": REASON_LABELS[r]} for r in OUT_REASONS if r != "transfer_out"
        ],
    }


@router.get("/accounts", response_model=MoneyOverview)
def get_accounts(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "user")),
):
    overview = MoneyService(db, auth.company_id).overview(include_inactive)
    db.commit()  # ensure_accounts may have created the till or a card account
    return overview


@router.post("/accounts", response_model=MoneyAccountOut, status_code=201)
def create_account(
    payload: MoneyAccountCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "manager")),
):
    service = MoneyService(db, auth.company_id)
    try:
        account = service.create_account(payload.name, payload.opening_balance, auth.user.id)
    except MoneyError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    balance = service.repo.balances(auth.company_id, [account]).get(account.id)
    return MoneyAccountOut(
        id=account.id,
        name=account.name,
        is_till=account.is_till,
        card_type=account.card_type,
        balance=balance,
        opening_balance=account.opening_balance,
        opening_at=account.opening_at,
        is_active=account.is_active,
        sort_order=account.sort_order,
    )


@router.patch("/accounts/{account_id}", response_model=MoneyAccountOut)
def update_account(
    account_id: int,
    payload: MoneyAccountUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "manager")),
):
    service = MoneyService(db, auth.company_id)
    try:
        account = service.update_account(account_id, **payload.model_dump(exclude_unset=True))
    except MoneyError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    balance = service.repo.balances(auth.company_id, [account]).get(account.id)
    return MoneyAccountOut(
        id=account.id,
        name=account.name,
        is_till=account.is_till,
        card_type=account.card_type,
        balance=balance,
        opening_balance=account.opening_balance,
        opening_at=account.opening_at,
        is_active=account.is_active,
        sort_order=account.sort_order,
    )


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    account_id: Optional[int] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "user")),
):
    return MoneyService(db, auth.company_id).history(
        account_id, start_date, end_date, limit, offset
    )


@router.post("/movements", response_model=MovementOut, status_code=201)
def create_movement(
    payload: MovementCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "manager")),
):
    service = MoneyService(db, auth.company_id)
    try:
        movement = service.record(payload, auth.user.id)
    except MoneyError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    db.refresh(movement)
    return service.to_out(movement)


@router.post("/till", response_model=MovementOut, status_code=201)
def create_till_movement(
    payload: MovementCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("register", "manager")),
):
    """Cash in or out of the drawer, recorded from the shift page.

    Same operation as `POST /money/movements`, reached by the cashier who has
    the drawer open rather than by whoever manages the accounts. The service
    refuses anything but the till here.
    """
    service = MoneyService(db, auth.company_id)
    service.ensure_accounts()
    till = service.repo.till(auth.company_id)
    if till is None or payload.account_id != till.id:
        db.rollback()
        raise HTTPException(status_code=400, detail="Этот маршрут только для кассы")
    try:
        movement = service.record(payload, auth.user.id)
    except MoneyError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    db.refresh(movement)
    return service.to_out(movement)


@router.post("/transfers", response_model=list[MovementOut], status_code=201)
def create_transfer(
    payload: TransferCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "manager")),
):
    """Move money between two accounts — both legs written together."""
    service = MoneyService(db, auth.company_id)
    try:
        legs = service.transfer(payload, auth.user.id)
    except MoneyError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    for leg in legs:
        db.refresh(leg)
    return [service.to_out(leg) for leg in legs]


@router.post("/corrections", response_model=Optional[MovementOut])
def correct_balance(
    payload: BalanceCorrection,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("finance", "manager")),
):
    """Bring an account to a stated balance by recording the difference.

    Returns null when the balance already matches — nothing happened, so
    nothing is written.
    """
    service = MoneyService(db, auth.company_id)
    try:
        movement = service.correct_balance(payload, auth.user.id)
    except MoneyError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    if movement is None:
        return None
    db.refresh(movement)
    return service.to_out(movement)
