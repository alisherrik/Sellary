from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import (
    ACCESS_TOKEN_TYPE,
    LOGIN_TOKEN_TYPE,
    OWNER_ACCESS_TOKEN_TYPE,
    decode_access_token,
)
from models.company import Company
from models.company_membership import CompanyMembership
from models.membership_module_access import LEVELS, MODULES, MembershipModuleAccess
from models.user import User
from repositories.user_repository import UserRepository

security = HTTPBearer()


@dataclass
class AuthContext:
    user: User
    company: Company
    membership: CompanyMembership | None
    token_payload: dict
    effective_role: str

    @property
    def company_id(self) -> int:
        return self.company.id

    @property
    def role(self) -> str:
        return self.effective_role

    @property
    def is_super_admin_company_entry(self) -> bool:
        return bool(self.token_payload.get("super_admin_entry"))


@dataclass
class OwnerContext:
    user: User
    token_payload: dict


def get_token_payload(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    return payload


def get_access_token_payload(payload: dict = Depends(get_token_payload)) -> dict:
    if payload.get("token_type") != ACCESS_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    return payload


def get_login_token_payload(payload: dict = Depends(get_token_payload)) -> dict:
    if payload.get("token_type") != LOGIN_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    return payload


def get_owner_token_payload(payload: dict = Depends(get_token_payload)) -> dict:
    if payload.get("token_type") != OWNER_ACCESS_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    return payload


def get_auth_context(
    payload: dict = Depends(get_access_token_payload),
    db: Session = Depends(get_db),
) -> AuthContext:
    user_id = payload.get("user_id")
    company_id = payload.get("company_id")
    if user_id is None or company_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    user_repo = UserRepository(db)
    membership = (
        db.query(CompanyMembership)
        .options(
            joinedload(CompanyMembership.user),
            joinedload(CompanyMembership.company),
        )
        .filter(
            CompanyMembership.user_id == user_id,
            CompanyMembership.company_id == company_id,
            CompanyMembership.is_active == True,
        )
        .first()
    )
    if membership is not None and membership.company is not None and membership.company.is_active:
        if membership.user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        if not membership.user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account is disabled",
            )

        return AuthContext(
            user=membership.user,
            company=membership.company,
            membership=membership,
            token_payload=payload,
            effective_role=membership.role,
        )

    user = user_repo.get_by_id(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled",
        )

    if payload.get("global_role") == "super_admin" and payload.get("super_admin_entry"):
        company = (
            db.query(Company)
            .filter(Company.id == company_id, Company.is_active == True)
            .first()
        )
        if company is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Company access not found",
            )

        return AuthContext(
            user=user,
            company=company,
            membership=None,
            token_payload=payload,
            effective_role=payload.get("role", "admin"),
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Company access not found",
    )


def get_current_user(auth: AuthContext = Depends(get_auth_context)) -> User:
    return auth.user


def get_owner_context(
    payload: dict = Depends(get_owner_token_payload),
    db: Session = Depends(get_db),
) -> OwnerContext:
    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    user = UserRepository(db).get_by_id(user_id)
    if user is None or not user.is_active or user.global_role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Super admin access required",
        )

    return OwnerContext(user=user, token_payload=payload)


def require_admin(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
    if auth.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return auth


def require_manager_or_admin(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
    if auth.role not in ["admin", "manager"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager or admin access required",
        )
    return auth


def require_super_admin(owner: OwnerContext = Depends(get_owner_context)) -> OwnerContext:
    return owner


_LEVEL_RANK = {"user": 1, "manager": 2}


def require_module(module: str, level: str = "user"):
    """Dependency factory: 403 unless the member has `module` at >= `level`.

    Membership role `admin` (including super-admin company entry) bypasses.
    """
    if module not in MODULES:
        raise ValueError(f"Unknown module: {module}")
    if level not in LEVELS:
        raise ValueError(f"Unknown level: {level}")

    def checker(
        auth: AuthContext = Depends(get_auth_context),
        db: Session = Depends(get_db),
    ) -> AuthContext:
        if auth.role == "admin":
            return auth
        grant = None
        if auth.membership is not None:
            grant = (
                db.query(MembershipModuleAccess)
                .filter(
                    MembershipModuleAccess.membership_id == auth.membership.id,
                    MembershipModuleAccess.module == module,
                )
                .first()
            )
        if grant is None or _LEVEL_RANK[grant.level] < _LEVEL_RANK[level]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "module_access_denied",
                    "module": module,
                    "required_level": level,
                },
            )
        return auth

    return checker
