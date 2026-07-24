from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from schemas.supplier import SupplierCreate, SupplierResponse, SupplierUpdate
from services.supplier_service import SupplierService

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("", response_model=list[SupplierResponse])
def get_suppliers(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    service = SupplierService(db, auth.company_id)
    suppliers, _ = service.get_all(skip=skip, limit=limit, search=search)
    return suppliers


@router.get("/{supplier_id}", response_model=SupplierResponse)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    service = SupplierService(db, auth.company_id)
    supplier = service.get_by_id(supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.post("", response_model=SupplierResponse, status_code=201)
def create_supplier(
    supplier_create: SupplierCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    service = SupplierService(db, auth.company_id)
    try:
        return service.create(supplier_create)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: int,
    supplier_update: SupplierUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    service = SupplierService(db, auth.company_id)
    try:
        return service.update(supplier_id, supplier_update)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.delete("/{supplier_id}", status_code=204)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing", "manager")),
):
    service = SupplierService(db, auth.company_id)
    try:
        service.delete(supplier_id)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
