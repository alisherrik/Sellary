"""Shopper-facing (public) response schemas.

Deliberately narrow: no cost_price, inventory_value, profit_percent, or exact
stock — a shopper must never see a merchant's margins. Stock is surfaced only as
an ``in_stock`` boolean hint (catalog does not hard-reserve; see design 7).
"""
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class ShopSummary(BaseModel):
    company_id: int
    slug: str
    name: str
    logo_url: Optional[str] = None
    marketplace_description: Optional[str] = None
    supports_delivery: bool
    supports_pickup: bool

    class Config:
        from_attributes = True


class ShopCategory(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class ShopProduct(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    sell_price: Decimal
    image_url: Optional[str] = None
    uom: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    company_id: int
    company_name: str
    company_slug: str
    in_stock: bool

    class Config:
        from_attributes = True


class CatalogPage(BaseModel):
    items: List[ShopProduct]
    total: int
    skip: int
    limit: int


class ShopDetail(BaseModel):
    shop: ShopSummary
    products: List[ShopProduct]
