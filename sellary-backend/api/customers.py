from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from models.customer import Customer as CustomerModel
from repositories.customer_repository import CustomerRepository
from schemas.customer import Customer, CustomerCreate, CustomerUpdate

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[Customer])
def get_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    return repo.get_all(auth.company_id, skip=skip, limit=limit, search=search)


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
    return customer


@router.post("", response_model=Customer, status_code=201)
def create_customer(
    customer_create: CustomerCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    if customer_create.phone and repo.get_by_phone(auth.company_id, customer_create.phone):
        raise HTTPException(status_code=400, detail="Customer with this phone already exists")
    return repo.create(CustomerModel(company_id=auth.company_id, **customer_create.model_dump()))


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

    return repo.update(customer)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CustomerRepository(db)
    if not repo.delete(auth.company_id, customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
