from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr

from core.modules import MODULES

GlobalUserRole = Literal["standard", "super_admin"]
TenantUserRole = Literal["admin", "manager", "cashier"]
# Derived from the registry rather than restated. Written out, this literal
# silently rejected the eighth module the day it was added, and the failure
# surfaced as a 500 on login rather than anywhere near the registry.
ModuleKey = Literal[MODULES]  # type: ignore[valid-type]
ModuleLevel = Literal["user", "manager"]


class UserBase(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str
    role: TenantUserRole = "cashier"


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class User(UserBase):
    id: int
    global_role: GlobalUserRole
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UserLogin(BaseModel):
    username: str
    password: str


class CompanySummary(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool
    role: TenantUserRole
    is_default: bool


class LoginResponse(BaseModel):
    login_token: str
    token_type: str = "bearer"
    user: User
    companies: list[CompanySummary]


class CompanySelectRequest(BaseModel):
    company_id: int


class CompanySession(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User
    current_company: CompanySummary
    companies: list[CompanySummary]
    modules: dict[ModuleKey, ModuleLevel] = {}
    # What the company has, regardless of this user's grants.
    company_modules: list[ModuleKey] = []


class AuthSession(BaseModel):
    user: User
    current_company: CompanySummary
    companies: list[CompanySummary]
    modules: dict[ModuleKey, ModuleLevel] = {}
    # What the company has, regardless of this user's grants.
    company_modules: list[ModuleKey] = []


class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None
    global_role: Optional[GlobalUserRole] = None
    company_id: Optional[int] = None
    role: Optional[TenantUserRole] = None
    token_type: Optional[str] = None
