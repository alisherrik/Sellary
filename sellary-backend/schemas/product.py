from decimal import Decimal
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class ProductType(str, Enum):
    ITEM = "item"
    DISH = "dish"


class ProductBase(BaseModel):
    barcode: Optional[str] = Field(None, min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    category_id: Optional[int] = None
    product_type: ProductType = Field(default=ProductType.ITEM)
    cost_price: Decimal = Field(..., ge=0, decimal_places=2)
    sell_price: Decimal = Field(..., ge=0, decimal_places=2)
    tax_percent: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    stock_quantity: int = Field(default=0)
    min_stock_level: int = Field(default=5, ge=0)


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    barcode: Optional[str] = Field(None, min_length=1, max_length=50)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    category_id: Optional[int] = None
    product_type: Optional[ProductType] = None
    cost_price: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    sell_price: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    tax_percent: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    stock_quantity: Optional[int] = Field(None, ge=0)
    min_stock_level: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


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
    product_type: ProductType
