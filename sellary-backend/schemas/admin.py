from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, model_validator

from schemas.user import GlobalUserRole, TenantUserRole, User


class OwnerLoginRequest(BaseModel):
    username: str
    password: str


class OwnerLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User


class OwnerSession(BaseModel):
    user: User


class AdminCompanySummary(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool

    class Config:
        from_attributes = True


class AdminMembershipUserSummary(BaseModel):
    id: int
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    global_role: GlobalUserRole
    is_active: bool

    class Config:
        from_attributes = True


class AdminMembershipSummary(BaseModel):
    id: int
    company_id: int
    user_id: int
    role: TenantUserRole
    is_default: bool
    is_active: bool
    created_at: datetime
    company: AdminCompanySummary

    class Config:
        from_attributes = True


class ManagedUserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    global_role: GlobalUserRole
    is_active: bool
    created_at: datetime
    memberships: list[AdminMembershipSummary] = Field(default_factory=list)


class ManagedUserCreate(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    password: str
    is_active: bool = True


class ManagedUserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None


class ManagedCompanyResponse(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ManagedCompanyCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    is_active: bool = True


class ManagedCompanyUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    is_active: Optional[bool] = None


class ManagedMembershipCompanySummary(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool

    class Config:
        from_attributes = True


class ManagedMembershipUserSummary(BaseModel):
    id: int
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    global_role: GlobalUserRole
    is_active: bool

    class Config:
        from_attributes = True


class ManagedMembershipResponse(BaseModel):
    id: int
    user_id: int
    company_id: int
    role: TenantUserRole
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    user: ManagedMembershipUserSummary
    company: ManagedMembershipCompanySummary

    class Config:
        from_attributes = True


class ManagedMembershipCreate(BaseModel):
    user_id: int
    company_id: int
    role: TenantUserRole = "cashier"
    is_default: bool = False
    is_active: bool = True


class ManagedMembershipUpdate(BaseModel):
    role: Optional[TenantUserRole] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class CompanyAdminUserCreate(ManagedUserCreate):
    role: TenantUserRole = "cashier"
    is_default: bool = True


class CompanyAdminMembershipCreate(BaseModel):
    user_id: Optional[int] = None
    identifier: Optional[str] = None
    role: TenantUserRole = "cashier"
    is_default: bool = False
    is_active: bool = True

    @model_validator(mode="after")
    def validate_identity(self) -> "CompanyAdminMembershipCreate":
        if self.user_id is None and not self.identifier:
            raise ValueError("Either user_id or identifier is required")
        return self
