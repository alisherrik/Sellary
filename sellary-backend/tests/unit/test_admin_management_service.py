from core.security import get_password_hash
from models.company_membership import CompanyMembership
from models.user import User
from schemas.admin import (
    CompanyAdminMembershipCreate,
    CompanyAdminUserCreate,
    ManagedMembershipCreate,
    ManagedMembershipUpdate,
)
from services.admin_management import AdminManagementService


def create_standard_user(db_session, *, username: str, email: str, role: str = "cashier") -> User:
    user = User(
        username=username,
        email=email,
        full_name=username.title(),
        hashed_password=get_password_hash("password123"),
        global_role="standard",
        role=role,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


class TestAdminManagementService:
    def test_create_membership_moves_default_to_new_membership(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        user = create_standard_user(
            db_session,
            username="multi-company-user",
            email="multi-company-user@test.com",
        )
        db_session.add(
            CompanyMembership(
                user_id=user.id,
                company_id=default_company.id,
                role="cashier",
                is_default=True,
                is_active=True,
            )
        )
        db_session.commit()

        service = AdminManagementService(db_session)
        created = service.create_membership(
            ManagedMembershipCreate(
                user_id=user.id,
                company_id=secondary_company.id,
                role="manager",
                is_default=True,
                is_active=True,
            )
        )

        assert created.company_id == secondary_company.id
        memberships = (
            db_session.query(CompanyMembership)
            .filter(CompanyMembership.user_id == user.id)
            .order_by(CompanyMembership.company_id.asc())
            .all()
        )
        assert memberships[0].is_default is False
        assert memberships[1].is_default is True

    def test_create_company_admin_user_creates_company_membership(
        self,
        db_session,
        default_company,
    ):
        service = AdminManagementService(db_session)
        created = service.create_company_admin_user(
            default_company.id,
            CompanyAdminUserCreate(
                username="company-admin-user",
                email="company-admin-user@test.com",
                full_name="Company Admin User",
                password="password123",
                role="manager",
                is_active=True,
                is_default=True,
            ),
        )

        assert created.username == "company-admin-user"
        assert len(created.memberships) == 1
        assert created.memberships[0].company.id == default_company.id
        assert created.memberships[0].role == "manager"

    def test_company_admin_membership_create_accepts_identifier(
        self,
        db_session,
        default_company,
    ):
        user = create_standard_user(
            db_session,
            username="attachable-user",
            email="attachable-user@test.com",
        )
        db_session.commit()

        service = AdminManagementService(db_session)
        created = service.create_company_membership(
            default_company.id,
            CompanyAdminMembershipCreate(
                identifier="attachable-user",
                role="cashier",
                is_default=False,
                is_active=True,
            ),
        )

        assert created.user_id == user.id
        assert created.company_id == default_company.id

    def test_update_membership_rejects_wrong_company_scope(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        user = create_standard_user(
            db_session,
            username="scoped-user",
            email="scoped-user@test.com",
        )
        membership = CompanyMembership(
            user_id=user.id,
            company_id=secondary_company.id,
            role="cashier",
            is_default=True,
            is_active=True,
        )
        db_session.add(membership)
        db_session.commit()

        service = AdminManagementService(db_session)

        try:
            service.update_membership(
                membership.id,
                ManagedMembershipUpdate(role="manager"),
                allowed_company_id=default_company.id,
            )
            assert False, "Expected permission error"
        except PermissionError as exc:
            assert str(exc) == "Membership is outside the current company"
