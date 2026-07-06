from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from models.customer import Customer as CustomerModel
from repositories.customer_repository import CustomerRepository
from schemas.customer import Customer, CustomerCreate, CustomerUpdate
from schemas.customer_ledger import (
    CustomerLedgerResponse,
    CustomerPaymentCreate,
    CustomerPaymentResponse,
)
from services.customer_ledger_service import CustomerLedgerService

router = APIRouter(prefix="/customers", tags=["customers"])


def _customer_with_balance(
    customer: CustomerModel,
    ledger_service: CustomerLedgerService,
) -> CustomerModel:
    customer.balance = ledger_service.get_customer_balance(customer.id)
    return customer


@router.get("", response_model=list[Customer])
def get_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    ledger_service = CustomerLedgerService(db, auth.company_id)
    return [
        _customer_with_balance(customer, ledger_service)
        for customer in repo.get_all(auth.company_id, skip=skip, limit=limit, search=search)
    ]


@router.get("/{customer_id}", response_model=Customer)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    customer = repo.get_by_id(auth.company_id, customer_id)
    if not customer or not customer.is_active:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _customer_with_balance(customer, CustomerLedgerService(db, auth.company_id))


@router.get("/{customer_id}/ledger", response_model=CustomerLedgerResponse)
def get_customer_ledger(
    customer_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    try:
        return CustomerLedgerService(db, auth.company_id).get_customer_ledger(customer_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{customer_id}/payments", response_model=CustomerPaymentResponse, status_code=201)
def record_customer_payment(
    customer_id: int,
    payment: CustomerPaymentCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = f"/api/customers/{customer_id}/payments"
    request_body = payment.model_dump()

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
            return CustomerPaymentResponse(**response_body)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    try:
        result = CustomerLedgerService(db, auth.company_id).record_payment(
            customer_id,
            payment,
            auth.user.id,
        )
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=jsonable_encoder(result),
            status_code=201,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message)


@router.post("", response_model=Customer, status_code=201)
def create_customer(
    customer_create: CustomerCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    if customer_create.phone and repo.get_by_phone(auth.company_id, customer_create.phone):
        raise HTTPException(status_code=400, detail="Customer with this phone already exists")
    customer = repo.create(CustomerModel(company_id=auth.company_id, **customer_create.model_dump()))
    return _customer_with_balance(customer, CustomerLedgerService(db, auth.company_id))


@router.put("/{customer_id}", response_model=Customer)
def update_customer(
    customer_id: int,
    customer_update: CustomerUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    customer = repo.get_by_id(auth.company_id, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    update_data = customer_update.model_dump(exclude_unset=True)
    phone = update_data.get("phone")
    if phone:
        existing = repo.get_by_phone(auth.company_id, phone)
        if existing and existing.id != customer_id:
            raise HTTPException(status_code=400, detail="Customer with this phone already exists")
    for field, value in update_data.items():
        setattr(customer, field, value)

    customer = repo.update(customer)
    return _customer_with_balance(customer, CustomerLedgerService(db, auth.company_id))


@router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    if not repo.delete(auth.company_id, customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
