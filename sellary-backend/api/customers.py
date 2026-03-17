from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from core.database import get_db
from schemas.customer import CustomerCreate, CustomerUpdate, Customer
from repositories.customer_repository import CustomerRepository
from models.customer import Customer as CustomerModel
from api.dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[Customer])
def get_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CustomerRepository(db)
    return repo.get_all(skip=skip, limit=limit, search=search)


@router.get("/{customer_id}", response_model=Customer)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CustomerRepository(db)
    customer = repo.get_by_id(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.post("", response_model=Customer, status_code=201)
def create_customer(
    customer_create: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CustomerRepository(db)
    if customer_create.phone and repo.get_by_phone(customer_create.phone):
        raise HTTPException(status_code=400, detail="Customer with this phone already exists")
    return repo.create(CustomerModel(**customer_create.model_dump()))


@router.put("/{customer_id}", response_model=Customer)
def update_customer(
    customer_id: int,
    customer_update: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CustomerRepository(db)
    customer = repo.get_by_id(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    update_data = customer_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(customer, field, value)

    return repo.update(customer)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CustomerRepository(db)
    if not repo.delete(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
