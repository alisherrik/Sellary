from decimal import Decimal
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from enum import Enum


class ProductUnitBase(BaseModel):
    """An additional sellable unit on top of the product's base unit."""

    name: str = Field(..., min_length=1, max_length=20)
    # Base units per 1 of this unit (1 sack = 5 kg -> 5; a 300 g portion -> 0.3).
    factor: Decimal = Field(..., gt=0, decimal_places=4)
    sell_price: Decimal = Field(..., ge=0, decimal_places=2)
    barcode: Optional[str] = Field(None, min_length=1, max_length=50)
    is_active: bool = True
    sort_order: int = 0


class ProductUnitCreate(ProductUnitBase):
    pass


class ProductUnitResponse(ProductUnitBase):
    id: int

    class Config:
        from_attributes = True


class ProductBase(BaseModel):
    barcode: Optional[str] = Field(None, min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    uom: str = Field(default="dona", min_length=1, max_length=20)
    category_id: Optional[int] = None
    # 4 decimals to carry precise weighted-average cost from wholesale receipts.
    cost_price: Decimal = Field(..., ge=0, decimal_places=4)
    sell_price: Decimal = Field(..., ge=0, decimal_places=2)
    tax_percent: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    stock_quantity: Decimal = Field(default=Decimal("0.000"), ge=0, decimal_places=3)
    min_stock_level: Decimal = Field(default=Decimal("5.000"), ge=0, decimal_places=3)


class ProductCreate(ProductBase):
    # Additional sale units (beyond the base uom). Optional.
    units: Optional[List[ProductUnitCreate]] = None


class ProductUpdate(BaseModel):
    barcode: Optional[str] = Field(None, min_length=1, max_length=50)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    uom: Optional[str] = Field(None, min_length=1, max_length=20)
    category_id: Optional[int] = None
    cost_price: Optional[Decimal] = Field(None, ge=0, decimal_places=4)
    sell_price: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    tax_percent: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    stock_quantity: Optional[Decimal] = Field(None, ge=0, decimal_places=3)
    min_stock_level: Optional[Decimal] = Field(None, ge=0, decimal_places=3)
    is_active: Optional[bool] = None
    # When provided, replaces the product's additional sale units (units removed
    # from the list are deactivated, not hard-deleted, to keep sale FKs valid).
    units: Optional[List[ProductUnitCreate]] = None


class Product(ProductBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProductResponse(Product):
    category: Optional[dict] = None
    profit_percent: Optional[Decimal] = None
    uom: str = Field(default="dona")
    # Active additional sale units (the base unit is conveyed by uom/sell_price).
    units: List[ProductUnitResponse] = []
