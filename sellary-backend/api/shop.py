from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.shop_dependencies import get_telegram_shopper
from core.config import settings
from core.database import get_db
from models.telegram_user import TelegramUser
from schemas.shop import CatalogPage, ShopCategory, ShopDetail, ShopProduct, ShopSummary
from services.shop_service import ShopService

router = APIRouter(prefix="/shop", tags=["shop"])


@router.get("/catalog", response_model=CatalogPage)
def get_catalog(
    search: Optional[str] = None,
    category: Optional[int] = Query(None, description="category_id filter"),
    company: Optional[int] = Query(None, description="company_id filter"),
    skip: int = Query(0, ge=0),
    limit: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopService(db).catalog(
        skip=skip,
        limit=limit,
        search=search,
        category_id=category,
        company_id=company,
    )


@router.get("/products/{product_id}", response_model=ShopProduct)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    product = ShopService(db).get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/shops", response_model=List[ShopSummary])
def list_shops(
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopService(db).list_shops()


@router.get("/shops/{slug}", response_model=ShopDetail)
def get_shop(
    slug: str,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    detail = ShopService(db).get_shop(slug)
    if detail is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    return detail


@router.get("/categories", response_model=List[ShopCategory])
def list_categories(
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopService(db).list_categories()
