from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from schemas.product import ProductCreate, ProductResponse, ProductUpdate
from services.image_upload_service import ImageUploadService
from services.platform_settings_service import PlatformSettingsService
from services.product_service import ProductService

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductResponse])
def get_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    products, _ = service.get_all(skip=skip, limit=limit, search=search, category_id=category_id)
    return products


@router.get("/search", response_model=list[ProductResponse])
def search_products(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    return service.search(q, limit=limit)


@router.get("/barcode/{barcode}", response_model=ProductResponse)
def get_product_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    product = service.get_by_barcode(barcode)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/low-stock", response_model=list[ProductResponse])
def get_low_stock(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    return service.get_low_stock()


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    product = service.get_by_id(product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.post("", response_model=ProductResponse, status_code=201)
def create_product(
    product_create: ProductCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    try:
        response = service.create(product_create, user_id=auth.user.id)
        # Commit only once the product row, its initial ledger layer, the
        # product value and the inventory log are all staged.
        db.commit()
        return response
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        db.rollback()
        raise


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    product_update: ProductUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = ProductService(db, auth.company_id)
    try:
        response = service.update(product_id, product_update)
        db.commit()
        return response
    except ValueError as exc:
        db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    except Exception:
        db.rollback()
        raise


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory", "manager")),
):
    service = ProductService(db, auth.company_id)
    try:
        if not service.delete(product_id, user_id=auth.user.id):
            raise HTTPException(status_code=404, detail="Product not found")
        # Commit the stock write-off + soft-delete together.
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        db.rollback()
        raise


MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/{product_id}/image", response_model=ProductResponse)
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds 5 MB limit")

    service = ProductService(db, auth.company_id)
    product = service.get_by_id(product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")

    cloudinary_url = PlatformSettingsService(db).resolve("cloudinary_url")
    try:
        url = ImageUploadService(cloudinary_url).upload_product_image(
            data, filename=file.filename or "image"
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 503 if "not configured" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail)

    try:
        response = service.update(product_id, ProductUpdate(image_url=url))
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise
