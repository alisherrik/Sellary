from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from core.database import get_db
from schemas.supplier import SupplierCreate, SupplierUpdate, SupplierResponse
from services.supplier_service import SupplierService
from api.dependencies import get_current_user, require_manager_or_admin
from models.user import User

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("", response_model=list[SupplierResponse])
def get_suppliers(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SupplierService(db)
    suppliers, _ = service.get_all(skip=skip, limit=limit, search=search)
    return suppliers


@router.get("/{supplier_id}", response_model=SupplierResponse)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SupplierService(db)
    supplier = service.get_by_id(supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.post("", response_model=SupplierResponse, status_code=201)
def create_supplier(
    supplier_create: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = SupplierService(db)
    try:
        return service.create(supplier_create)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: int,
    supplier_update: SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = SupplierService(db)
    try:
        return service.update(supplier_id, supplier_update)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{supplier_id}", status_code=204)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = SupplierService(db)
    try:
        service.delete(supplier_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
