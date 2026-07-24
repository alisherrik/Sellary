from datetime import timedelta
from typing import Optional
from sqlalchemy.orm import Session

from models.company import Company
from models.company_membership import CompanyMembership
from models.membership_module_access import MODULES, MembershipModuleAccess
from repositories.user_repository import UserRepository
from models.user import User
from schemas.admin import OwnerLoginResponse, OwnerSession
from schemas.user import (
    AuthSession,
    CompanySession,
    CompanySummary,
    LoginResponse,
    UserCreate,
)
from core.security import (
    create_access_token,
    create_login_token,
    create_owner_access_token,
    get_password_hash,
    verify_password,
)
from core.config import settings


class AuthService:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)

    def authenticate(self, username: str, password: str) -> Optional[User]:
        user = self.user_repo.get_by_username(username)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        if not user.is_active:
            return None
        return user

    def authenticate_owner(self, username: str, password: str) -> Optional[User]:
        user = self.authenticate(username, password)
        if not user or user.global_role != "super_admin":
            return None
        return user

    def ensure_unique_user_credentials(
        self,
        *,
        username: str,
        email: str,
        exclude_user_id: int | None = None,
    ) -> None:
        existing_username = self.user_repo.get_by_username(username)
        if existing_username and existing_username.id != exclude_user_id:
            raise ValueError(f"Username '{username}' already exists")

        existing_email = self.user_repo.get_by_email(email)
        if existing_email and existing_email.id != exclude_user_id:
            raise ValueError(f"Email '{email}' already exists")

    def create_standard_user(
        self,
        *,
        username: str,
        email: str,
        password: str,
        full_name: str | None = None,
        is_active: bool = True,
        role: str = "cashier",
    ) -> User:
        self.ensure_unique_user_credentials(username=username, email=email)

        hashed_password = get_password_hash(password)
        user = User(
            username=username,
            email=email,
            full_name=full_name,
            hashed_password=hashed_password,
            role=role,
            global_role="standard",
            is_active=is_active,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def attach_user_to_company(
        self,
        user: User,
        company_id: int,
        *,
        role: str,
        is_default: bool = False,
        is_active: bool = True,
    ) -> CompanyMembership:
        membership = (
            self.db.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == user.id,
                CompanyMembership.company_id == company_id,
            )
            .first()
        )
        if membership is not None:
            raise ValueError("User is already attached to that company")

        membership = CompanyMembership(
            user_id=user.id,
            company_id=company_id,
            role=role,
            is_default=is_default,
            is_active=is_active,
        )
        self.db.add(membership)
        self.db.flush()
        return membership

    def create_user(self, user_create: UserCreate, company_id: int) -> User:
        user = self.create_standard_user(
            username=user_create.username,
            email=user_create.email,
            password=user_create.password,
            full_name=user_create.full_name,
            role=user_create.role,
        )
        membership = CompanyMembership(
            user_id=user.id,
            company_id=company_id,
            role=user_create.role,
            is_default=False,
            is_active=True,
        )
        self.db.add(membership)
        self.db.commit()
        self.db.refresh(user)
        return user

    def create_login_response(self, user: User) -> LoginResponse:
        companies = self.get_companies_for_user(user.id)
        if not companies:
            if user.global_role == "super_admin":
                raise ValueError("This account must use the owner login page")
            raise ValueError("User has no active company access")

        login_token = create_login_token(
            data={
                "sub": user.username,
                "user_id": user.id,
                "global_role": user.global_role,
            },
        )
        return LoginResponse(
            login_token=login_token,
            token_type="bearer",
            user=user,
            companies=companies,
        )

    def create_owner_login_response(self, user: User) -> OwnerLoginResponse:
        access_token = create_owner_access_token(
            data={
                "sub": user.username,
                "user_id": user.id,
                "global_role": user.global_role,
            }
        )
        return OwnerLoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=user,
        )

    def _module_map(
        self, membership: CompanyMembership | None, role: str
    ) -> dict[str, str]:
        """Resolve the module->level grant map for a membership.

        Admins bypass module gating entirely and are treated as manager on
        every module. A missing membership (e.g. super-admin company entry
        with no real CompanyMembership row) has no grants of its own.
        """
        if role == "admin":
            return {module: "manager" for module in MODULES}
        if membership is None:
            return {}
        rows = (
            self.db.query(MembershipModuleAccess)
            .filter(MembershipModuleAccess.membership_id == membership.id)
            .all()
        )
        return {row.module: row.level for row in rows}

    def create_company_session(self, user: User, company_id: int) -> CompanySession:
        membership = (
            self.db.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == user.id,
                CompanyMembership.company_id == company_id,
                CompanyMembership.is_active == True,
            )
            .first()
        )
        if membership is None:
            if user.global_role == "super_admin":
                company = (
                    self.db.query(Company)
                    .filter(Company.id == company_id, Company.is_active == True)
                    .first()
                )
                if company is None:
                    raise ValueError("Company access not found")
                return self.create_super_admin_company_session(user, company)
            raise ValueError("Company access not found")

        if membership.company is None or not membership.company.is_active:
            raise ValueError("Company access not found")

        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={
                "sub": user.username,
                "user_id": user.id,
                "company_id": membership.company_id,
                "role": membership.role,
                "global_role": user.global_role,
            },
            expires_delta=access_token_expires,
        )
        companies = self.get_companies_for_user(user.id)
        current_company = next(
            company for company in companies if company.id == membership.company_id
        )
        return CompanySession(
            access_token=access_token,
            token_type="bearer",
            user=user,
            current_company=current_company,
            companies=companies,
            modules=self._module_map(membership, membership.role),
        )

    def create_super_admin_company_session(self, user: User, company: Company) -> CompanySession:
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        current_company = CompanySummary(
            id=company.id,
            name=company.name,
            slug=company.slug,
            is_active=company.is_active,
            role="admin",
            is_default=True,
        )
        access_token = create_access_token(
            data={
                "sub": user.username,
                "user_id": user.id,
                "company_id": company.id,
                "role": "admin",
                "global_role": user.global_role,
                "super_admin_entry": True,
            },
            expires_delta=access_token_expires,
        )
        return CompanySession(
            access_token=access_token,
            token_type="bearer",
            user=user,
            current_company=current_company,
            companies=[current_company],
            modules=self._module_map(None, "admin"),
        )

    def get_auth_session(
        self,
        user: User,
        company_id: int,
        *,
        current_role: str | None = None,
        allow_super_admin_company: bool = False,
    ) -> AuthSession:
        companies = self.get_companies_for_user(user.id)
        membership: CompanyMembership | None = None
        try:
            current_company = next(company for company in companies if company.id == company_id)
            membership = (
                self.db.query(CompanyMembership)
                .filter(
                    CompanyMembership.user_id == user.id,
                    CompanyMembership.company_id == company_id,
                    CompanyMembership.is_active == True,
                )
                .first()
            )
        except StopIteration as exc:
            if not allow_super_admin_company or user.global_role != "super_admin":
                raise ValueError("Company access not found") from exc

            company = (
                self.db.query(Company)
                .filter(Company.id == company_id, Company.is_active == True)
                .first()
            )
            if company is None:
                raise ValueError("Company access not found") from exc

            current_company = CompanySummary(
                id=company.id,
                name=company.name,
                slug=company.slug,
                is_active=company.is_active,
                role=current_role or "admin",
                is_default=True,
            )
            companies = [current_company]

        return AuthSession(
            user=user,
            modules=self._module_map(membership, current_company.role),
            current_company=current_company,
            companies=companies,
        )

    def get_owner_session(self, user: User) -> OwnerSession:
        return OwnerSession(user=user)

    def get_companies_for_user(self, user_id: int) -> list[CompanySummary]:
        memberships = (
            self.db.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == user_id,
                CompanyMembership.is_active == True,
            )
            .all()
        )
        active_memberships = [
            membership
            for membership in memberships
            if membership.company is not None and membership.company.is_active
        ]
        active_memberships.sort(
            key=lambda membership: (
                0 if membership.is_default else 1,
                membership.company.name.lower(),
            )
        )
        return [
            CompanySummary(
                id=membership.company.id,
                name=membership.company.name,
                slug=membership.company.slug,
                is_active=membership.company.is_active,
                role=membership.role,
                is_default=membership.is_default,
            )
            for membership in active_memberships
        ]
