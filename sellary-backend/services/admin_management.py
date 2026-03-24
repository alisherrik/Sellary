from __future__ import annotations

from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from bootstrap_utils import slugify_company_name
from models.company import Company
from models.company_membership import CompanyMembership
from models.user import User
from repositories.user_repository import UserRepository
from schemas.admin import (
    CompanyAdminMembershipCreate,
    CompanyAdminUserCreate,
    ManagedCompanyCreate,
    ManagedCompanyResponse,
    ManagedCompanyUpdate,
    ManagedMembershipCreate,
    ManagedMembershipResponse,
    ManagedMembershipUpdate,
    ManagedUserCreate,
    ManagedUserResponse,
    ManagedUserUpdate,
)
from schemas.user import CompanySession
from services.auth_service import AuthService


class AdminManagementService:
    def __init__(self, db: Session):
        self.db = db
        self.auth_service = AuthService(db)
        self.user_repo = UserRepository(db)

    def list_users(
        self,
        *,
        search: str | None = None,
        company_id: int | None = None,
    ) -> list[ManagedUserResponse]:
        query = self.db.query(User).options(
            joinedload(User.memberships).joinedload(CompanyMembership.company)
        )
        if search:
            term = f"%{search}%"
            query = query.filter(
                or_(
                    User.username.ilike(term),
                    User.email.ilike(term),
                    User.full_name.ilike(term),
                )
            )
        if company_id is not None:
            query = query.join(User.memberships).filter(CompanyMembership.company_id == company_id)

        users = query.order_by(User.created_at.desc(), User.id.desc()).distinct().all()
        return [self._to_managed_user_response(user, company_id=company_id) for user in users]

    def create_user(self, payload: ManagedUserCreate) -> ManagedUserResponse:
        user = self.auth_service.create_standard_user(
            username=payload.username,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            is_active=payload.is_active,
        )
        self.db.commit()
        return self.get_user(user.id)

    def create_company_admin_user(
        self,
        company_id: int,
        payload: CompanyAdminUserCreate,
    ) -> ManagedUserResponse:
        self._get_company(company_id)
        user = self.auth_service.create_standard_user(
            username=payload.username,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            is_active=payload.is_active,
            role=payload.role,
        )
        membership = self.auth_service.attach_user_to_company(
            user,
            company_id,
            role=payload.role,
            is_default=payload.is_default,
            is_active=payload.is_active,
        )
        self._normalize_user_defaults(
            user.id,
            preferred_membership_id=membership.id if payload.is_default else None,
        )
        self.db.commit()
        return self.get_user(user.id, company_id=company_id)

    def get_user(self, user_id: int, *, company_id: int | None = None) -> ManagedUserResponse:
        user = (
            self.db.query(User)
            .options(joinedload(User.memberships).joinedload(CompanyMembership.company))
            .filter(User.id == user_id)
            .first()
        )
        if user is None:
            raise ValueError("User not found")
        return self._to_managed_user_response(user, company_id=company_id)

    def update_user(self, user_id: int, payload: ManagedUserUpdate) -> ManagedUserResponse:
        user = self._get_user(user_id)
        updates = payload.model_dump(exclude_unset=True)

        new_username = updates.get("username", user.username)
        new_email = updates.get("email", user.email)
        self.auth_service.ensure_unique_user_credentials(
            username=new_username,
            email=new_email,
            exclude_user_id=user.id,
        )

        for field, value in updates.items():
            setattr(user, field, value)

        self.db.commit()
        return self.get_user(user.id)

    def list_companies(self, *, search: str | None = None) -> list[ManagedCompanyResponse]:
        query = self.db.query(Company)
        if search:
            term = f"%{search}%"
            query = query.filter(
                or_(
                    Company.name.ilike(term),
                    Company.slug.ilike(term),
                )
            )
        companies = query.order_by(Company.created_at.desc(), Company.id.desc()).all()
        return [ManagedCompanyResponse.model_validate(company) for company in companies]

    def create_company(self, payload: ManagedCompanyCreate) -> ManagedCompanyResponse:
        slug = slugify_company_name(payload.slug or payload.name)
        self._ensure_company_slug_available(slug)
        company = Company(
            name=payload.name,
            slug=slug,
            is_active=payload.is_active,
        )
        self.db.add(company)
        self.db.commit()
        self.db.refresh(company)
        return ManagedCompanyResponse.model_validate(company)

    def update_company(self, company_id: int, payload: ManagedCompanyUpdate) -> ManagedCompanyResponse:
        company = self._get_company(company_id)
        updates = payload.model_dump(exclude_unset=True)
        if "name" in updates:
            company.name = updates["name"]
        if "slug" in updates:
            slug = slugify_company_name(updates["slug"] or company.name)
            self._ensure_company_slug_available(slug, exclude_company_id=company.id)
            company.slug = slug
        if "is_active" in updates:
            company.is_active = updates["is_active"]

        self.db.commit()
        self.db.refresh(company)
        return ManagedCompanyResponse.model_validate(company)

    def list_memberships(
        self,
        *,
        search: str | None = None,
        company_id: int | None = None,
    ) -> list[ManagedMembershipResponse]:
        query = self.db.query(CompanyMembership).options(
            joinedload(CompanyMembership.user),
            joinedload(CompanyMembership.company),
        )
        if company_id is not None:
            query = query.filter(CompanyMembership.company_id == company_id)
        if search:
            term = f"%{search}%"
            query = (
                query.join(CompanyMembership.user)
                .join(CompanyMembership.company)
                .filter(
                    or_(
                        User.username.ilike(term),
                        User.email.ilike(term),
                        User.full_name.ilike(term),
                        Company.name.ilike(term),
                        Company.slug.ilike(term),
                    )
                )
            )

        memberships = query.order_by(
            CompanyMembership.created_at.desc(),
            CompanyMembership.id.desc(),
        ).all()
        return [self._to_managed_membership_response(membership) for membership in memberships]

    def create_membership(self, payload: ManagedMembershipCreate) -> ManagedMembershipResponse:
        company = self._get_company(payload.company_id)
        user = self._get_user(payload.user_id)
        membership = self.auth_service.attach_user_to_company(
            user,
            company.id,
            role=payload.role,
            is_default=payload.is_default,
            is_active=payload.is_active,
        )
        self._normalize_user_defaults(
            user.id,
            preferred_membership_id=membership.id if payload.is_default else None,
        )
        self.db.commit()
        return self.get_membership(membership.id)

    def create_company_membership(
        self,
        company_id: int,
        payload: CompanyAdminMembershipCreate,
    ) -> ManagedMembershipResponse:
        self._get_company(company_id)
        user = self._resolve_existing_user(payload.user_id, payload.identifier)
        membership = self.auth_service.attach_user_to_company(
            user,
            company_id,
            role=payload.role,
            is_default=payload.is_default,
            is_active=payload.is_active,
        )
        self._normalize_user_defaults(
            user.id,
            preferred_membership_id=membership.id if payload.is_default else None,
        )
        self.db.commit()
        return self.get_membership(membership.id)

    def get_membership(self, membership_id: int) -> ManagedMembershipResponse:
        membership = (
            self.db.query(CompanyMembership)
            .options(
                joinedload(CompanyMembership.user),
                joinedload(CompanyMembership.company),
            )
            .filter(CompanyMembership.id == membership_id)
            .first()
        )
        if membership is None:
            raise ValueError("Membership not found")
        return self._to_managed_membership_response(membership)

    def update_membership(
        self,
        membership_id: int,
        payload: ManagedMembershipUpdate,
        *,
        allowed_company_id: int | None = None,
    ) -> ManagedMembershipResponse:
        membership = (
            self.db.query(CompanyMembership)
            .options(
                joinedload(CompanyMembership.user),
                joinedload(CompanyMembership.company),
            )
            .filter(CompanyMembership.id == membership_id)
            .first()
        )
        if membership is None:
            raise ValueError("Membership not found")
        if allowed_company_id is not None and membership.company_id != allowed_company_id:
            raise PermissionError("Membership is outside the current company")

        updates = payload.model_dump(exclude_unset=True)
        preferred_membership_id: int | None = None

        for field, value in updates.items():
            setattr(membership, field, value)

        if updates.get("is_default") is True:
            preferred_membership_id = membership.id

        self._normalize_user_defaults(
            membership.user_id,
            preferred_membership_id=preferred_membership_id,
        )
        self.db.commit()
        return self.get_membership(membership.id)

    def enter_company_as_super_admin(self, user: User, company_id: int) -> CompanySession:
        company = self._get_company(company_id)
        return self.auth_service.create_super_admin_company_session(user, company)

    def _resolve_existing_user(self, user_id: int | None, identifier: str | None) -> User:
        user = None
        if user_id is not None:
            user = self.user_repo.get_by_id(user_id)
        elif identifier:
            user = self.user_repo.get_by_identifier(identifier)

        if user is None:
            raise ValueError("User not found")
        return user

    def _normalize_user_defaults(
        self,
        user_id: int,
        *,
        preferred_membership_id: int | None = None,
    ) -> None:
        memberships = (
            self.db.query(CompanyMembership)
            .options(joinedload(CompanyMembership.company))
            .filter(CompanyMembership.user_id == user_id)
            .order_by(CompanyMembership.id.asc())
            .all()
        )
        active_memberships = [
            membership
            for membership in memberships
            if membership.is_active and membership.company is not None and membership.company.is_active
        ]

        if not active_memberships:
            for membership in memberships:
                membership.is_default = False
            self.db.flush()
            return

        chosen_membership = None
        if preferred_membership_id is not None:
            chosen_membership = next(
                (
                    membership
                    for membership in active_memberships
                    if membership.id == preferred_membership_id
                ),
                None,
            )

        if chosen_membership is None:
            current_defaults = [membership for membership in active_memberships if membership.is_default]
            chosen_membership = current_defaults[0] if current_defaults else active_memberships[0]

        for membership in memberships:
            membership.is_default = membership.id == chosen_membership.id

        self.db.flush()

    def _ensure_company_slug_available(
        self,
        slug: str,
        *,
        exclude_company_id: int | None = None,
    ) -> None:
        existing = self.db.query(Company).filter(Company.slug == slug).first()
        if existing is not None and existing.id != exclude_company_id:
            raise ValueError(f"Company slug '{slug}' already exists")

    def _get_user(self, user_id: int) -> User:
        user = self.user_repo.get_by_id(user_id)
        if user is None:
            raise ValueError("User not found")
        return user

    def _get_company(self, company_id: int) -> Company:
        company = self.db.query(Company).filter(Company.id == company_id).first()
        if company is None:
            raise ValueError("Company not found")
        return company

    def _to_managed_user_response(
        self,
        user: User,
        *,
        company_id: Optional[int] = None,
    ) -> ManagedUserResponse:
        memberships = [
            membership
            for membership in user.memberships
            if membership.company is not None and (company_id is None or membership.company_id == company_id)
        ]
        memberships.sort(key=lambda membership: (0 if membership.is_default else 1, membership.id))

        return ManagedUserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            full_name=user.full_name,
            global_role=user.global_role,
            is_active=user.is_active,
            created_at=user.created_at,
            memberships=[
                {
                    "id": membership.id,
                    "company_id": membership.company_id,
                    "user_id": membership.user_id,
                    "role": membership.role,
                    "is_default": membership.is_default,
                    "is_active": membership.is_active,
                    "created_at": membership.created_at,
                    "company": membership.company,
                }
                for membership in memberships
            ],
        )

    def _to_managed_membership_response(
        self,
        membership: CompanyMembership,
    ) -> ManagedMembershipResponse:
        if membership.user is None or membership.company is None:
            raise ValueError("Membership data is incomplete")

        return ManagedMembershipResponse(
            id=membership.id,
            user_id=membership.user_id,
            company_id=membership.company_id,
            role=membership.role,
            is_default=membership.is_default,
            is_active=membership.is_active,
            created_at=membership.created_at,
            updated_at=membership.updated_at,
            user=membership.user,
            company=membership.company,
        )
