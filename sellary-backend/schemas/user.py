from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr

GlobalUserRole = Literal["standard", "super_admin"]
TenantUserRole = Literal["admin", "manager", "cashier"]
ModuleKey = Literal["pos", "inventory", "purchasing", "shop", "reports"]
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


class AuthSession(BaseModel):
    user: User
    current_company: CompanySummary
    companies: list[CompanySummary]
    modules: dict[ModuleKey, ModuleLevel] = {}


class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None
    global_role: Optional[GlobalUserRole] = None
    company_id: Optional[int] = None
    role: Optional[TenantUserRole] = None
    token_type: Optional[str] = None
