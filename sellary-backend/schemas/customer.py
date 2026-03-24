from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class CustomerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[EmailStr] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=255)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[EmailStr] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class Customer(CustomerBase):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
