from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class SupplierBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    contact_person: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = Field(None, max_length=100)
    phone: str = Field(..., min_length=1, max_length=20)
    address: Optional[str] = None
    payment_terms: Optional[str] = Field(None, max_length=100)


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    contact_person: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, min_length=1, max_length=20)
    address: Optional[str] = None
    payment_terms: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None


class Supplier(SupplierBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SupplierResponse(Supplier):
    pass
