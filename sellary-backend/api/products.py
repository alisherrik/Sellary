from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from core.database import get_db
from schemas.product import ProductCreate, ProductUpdate, ProductResponse
from services.product_service import ProductService
from api.dependencies import get_current_user, require_manager_or_admin
from models.user import User

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductResponse])
def get_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ProductService(db)
    products, _ = service.get_all(skip=skip, limit=limit, search=search, category_id=category_id)
    return products


@router.get("/search", response_model=list[ProductResponse])
def search_products(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ProductService(db)
    return service.search(q, limit=limit)


@router.get("/barcode/{barcode}", response_model=ProductResponse)
def get_product_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ProductService(db)
    product = service.get_by_barcode(barcode)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/low-stock", response_model=list[ProductResponse])
def get_low_stock(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ProductService(db)
    return service.get_low_stock()


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ProductService(db)
    product = service.get_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.post("", response_model=ProductResponse, status_code=201)
def create_product(
    product_create: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = ProductService(db)
    try:
        return service.create(product_create)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    product_update: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = ProductService(db)
    try:
        return service.update(product_id, product_update)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    service = ProductService(db)
    if not service.delete(product_id):
        raise HTTPException(status_code=404, detail="Product not found")
