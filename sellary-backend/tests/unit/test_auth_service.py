"""
Unit tests for AuthService.
"""
from core.security import OWNER_ACCESS_TOKEN_TYPE, decode_access_token, get_password_hash
from models.company import Company
from models.company_membership import CompanyMembership
from models.user import User
from schemas.admin import OwnerLoginResponse, OwnerSession
from schemas.user import AuthSession, CompanySession, LoginResponse, UserCreate
from services.auth_service import AuthService


def create_user(
    db_session,
    *,
    username: str,
    email: str,
    password: str = "password123",
    role: str = "cashier",
    is_active: bool = True,
    global_role: str = "standard",
) -> User:
    user = User(
        username=username,
        email=email,
        full_name=f"{username.title()} User",
        hashed_password=get_password_hash(password),
        global_role=global_role,
        role=role,
        is_active=is_active,
    )
    db_session.add(user)
    db_session.flush()
    return user


def add_membership(
    db_session,
    *,
    user: User,
    company: Company,
    role: str,
    is_default: bool = True,
    is_active: bool = True,
) -> CompanyMembership:
    membership = CompanyMembership(
        user_id=user.id,
        company_id=company.id,
        role=role,
        is_default=is_default,
        is_active=is_active,
    )
    db_session.add(membership)
    db_session.flush()
    return membership


class TestAuthenticate:
    """Tests for user authentication."""

    def test_authenticate_with_valid_credentials(self, db_session):
        password = "test_password_123"
        user = create_user(
            db_session,
            username="testuser",
            email="test@test.com",
            password=password,
            role="cashier",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", password)

        assert result is not None
        assert result.id == user.id
        assert result.username == "testuser"
        assert result.is_active is True

    def test_authenticate_with_invalid_username(self, db_session):
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("nonexistent", "password")

        assert result is None

    def test_authenticate_with_invalid_password(self, db_session):
        create_user(
            db_session,
            username="testuser",
            email="test@test.com",
            password="test_password_123",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", "wrong_password")

        assert result is None

    def test_authenticate_with_inactive_user(self, db_session):
        password = "test_password_123"
        create_user(
            db_session,
            username="testuser",
            email="test@test.com",
            password=password,
            is_active=False,
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", password)

        assert result is None

    def test_authenticate_with_case_sensitive_username(self, db_session):
        password = "test_password_123"
        create_user(
            db_session,
            username="TestUser",
            email="test@test.com",
            password=password,
        )
        db_session.commit()

        auth_service = AuthService(db_session)

        assert auth_service.authenticate("testuser", password) is None
        assert auth_service.authenticate("TestUser", password) is not None

    def test_authenticate_owner_requires_super_admin_role(self, db_session):
        password = "owner_password_123"
        create_user(
            db_session,
            username="owner",
            email="owner@test.com",
            password=password,
            global_role="super_admin",
            role="admin",
        )
        create_user(
            db_session,
            username="normal-admin",
            email="normal@test.com",
            password=password,
            role="admin",
        )
        db_session.commit()

        auth_service = AuthService(db_session)

        assert auth_service.authenticate_owner("owner", password) is not None
        assert auth_service.authenticate_owner("normal-admin", password) is None


class TestCreateUser:
    """Tests for company-scoped user creation."""

    def test_create_user_with_valid_data(self, db_session, default_company):
        user_create = UserCreate(
            username="newuser",
            email="newuser@test.com",
            full_name="New User",
            password="password123",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create, default_company.id)

        membership = (
            db_session.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == result.id,
                CompanyMembership.company_id == default_company.id,
            )
            .one()
        )

        assert result.id is not None
        assert result.username == "newuser"
        assert result.email == "newuser@test.com"
        assert result.full_name == "New User"
        assert result.is_active is True
        assert result.hashed_password != "password123"
        assert membership.role == "cashier"
        assert membership.is_default is False

    def test_create_user_with_duplicate_username(self, db_session, default_company):
        create_user(
            db_session,
            username="existing_user",
            email="existing@test.com",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        user_create = UserCreate(
            username="existing_user",
            email="different@test.com",
            full_name="Different User",
            password="password123",
            role="cashier",
        )

        try:
            auth_service.create_user(user_create, default_company.id)
            assert False, "Expected duplicate username error"
        except ValueError as exc:
            assert "Username 'existing_user' already exists" == str(exc)

    def test_create_user_with_duplicate_email(self, db_session, default_company):
        create_user(
            db_session,
            username="existing_user",
            email="existing@test.com",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        user_create = UserCreate(
            username="different_user",
            email="existing@test.com",
            full_name="Different User",
            password="password123",
            role="cashier",
        )

        try:
            auth_service.create_user(user_create, default_company.id)
            assert False, "Expected duplicate email error"
        except ValueError as exc:
            assert "Email 'existing@test.com' already exists" == str(exc)

    def test_create_user_preserves_unicode_full_name(self, db_session, default_company):
        user_create = UserCreate(
            username="unicodeuser",
            email="unicode@test.com",
            full_name="Alisher Jurayev",
            password="password123",
            role="manager",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create, default_company.id)

        assert result.full_name == "Alisher Jurayev"
        membership = (
            db_session.query(CompanyMembership)
            .filter(CompanyMembership.user_id == result.id)
            .one()
        )
        assert membership.role == "manager"


class TestCompanyScopedSessions:
    """Tests for the multi-company login and session contract."""

    def test_create_login_response_returns_login_token_and_company_list(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        user = create_user(
            db_session,
            username="loginuser",
            email="login@test.com",
            role="cashier",
        )
        add_membership(
            db_session,
            user=user,
            company=default_company,
            role="cashier",
            is_default=True,
        )
        add_membership(
            db_session,
            user=user,
            company=secondary_company,
            role="manager",
            is_default=False,
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.create_login_response(user)

        assert isinstance(result, LoginResponse)
        assert result.user.id == user.id
        assert [company.slug for company in result.companies] == [
            default_company.slug,
            secondary_company.slug,
        ]

        payload = decode_access_token(result.login_token)
        assert payload is not None
        assert payload["sub"] == "loginuser"
        assert payload["user_id"] == user.id
        assert payload["token_type"] == "login"
        assert "company_id" not in payload

    def test_create_login_response_requires_active_company_access(self, db_session):
        user = create_user(
            db_session,
            username="orphanuser",
            email="orphan@test.com",
        )
        db_session.commit()

        auth_service = AuthService(db_session)

        try:
            auth_service.create_login_response(user)
            assert False, "Expected missing company access error"
        except ValueError as exc:
            assert str(exc) == "User has no active company access"

    def test_create_login_response_redirects_super_admin_to_owner_login(self, db_session):
        user = create_user(
            db_session,
            username="owner",
            email="owner@test.com",
            password="owner_password_123",
            global_role="super_admin",
            role="admin",
        )
        db_session.commit()

        auth_service = AuthService(db_session)

        try:
            auth_service.create_login_response(user)
            assert False, "Expected owner login guidance"
        except ValueError as exc:
            assert str(exc) == "This account must use the owner login page"

    def test_create_company_session_returns_company_scoped_access_token(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        user = create_user(
            db_session,
            username="shareduser",
            email="shared@test.com",
            role="admin",
        )
        add_membership(
            db_session,
            user=user,
            company=default_company,
            role="admin",
            is_default=True,
        )
        add_membership(
            db_session,
            user=user,
            company=secondary_company,
            role="manager",
            is_default=False,
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.create_company_session(user, secondary_company.id)

        assert isinstance(result, CompanySession)
        assert result.current_company.id == secondary_company.id
        assert result.current_company.role == "manager"
        assert len(result.companies) == 2

        payload = decode_access_token(result.access_token)
        assert payload is not None
        assert payload["sub"] == "shareduser"
        assert payload["user_id"] == user.id
        assert payload["company_id"] == secondary_company.id
        assert payload["role"] == "manager"
        assert payload["token_type"] == "access"

    def test_create_company_session_rejects_missing_membership(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        user = create_user(
            db_session,
            username="restricted",
            email="restricted@test.com",
        )
        add_membership(
            db_session,
            user=user,
            company=default_company,
            role="cashier",
            is_default=True,
        )
        db_session.commit()

        auth_service = AuthService(db_session)

        try:
            auth_service.create_company_session(user, secondary_company.id)
            assert False, "Expected missing company access error"
        except ValueError as exc:
            assert str(exc) == "Company access not found"

    def test_get_auth_session_returns_current_company_and_all_companies(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        user = create_user(
            db_session,
            username="sessionuser",
            email="session@test.com",
        )
        add_membership(
            db_session,
            user=user,
            company=default_company,
            role="cashier",
            is_default=True,
        )
        add_membership(
            db_session,
            user=user,
            company=secondary_company,
            role="manager",
            is_default=False,
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.get_auth_session(user, default_company.id)

        assert isinstance(result, AuthSession)
        assert result.user.id == user.id
        assert result.current_company.id == default_company.id
        assert result.current_company.role == "cashier"
        assert len(result.companies) == 2

    def test_get_companies_for_user_ignores_inactive_memberships_and_companies(
        self,
        db_session,
        default_company,
        secondary_company,
    ):
        archived_company = Company(name="Archived Company", slug="archived-company", is_active=False)
        inactive_company = Company(name="Inactive Membership Company", slug="inactive-membership-company", is_active=True)
        db_session.add(archived_company)
        db_session.add(inactive_company)
        db_session.flush()

        user = create_user(
            db_session,
            username="companylist",
            email="companylist@test.com",
        )
        add_membership(
            db_session,
            user=user,
            company=secondary_company,
            role="manager",
            is_default=False,
            is_active=True,
        )
        add_membership(
            db_session,
            user=user,
            company=default_company,
            role="admin",
            is_default=True,
            is_active=True,
        )
        add_membership(
            db_session,
            user=user,
            company=archived_company,
            role="cashier",
            is_default=False,
            is_active=True,
        )
        db_session.add(
            CompanyMembership(
                user_id=user.id,
                company_id=inactive_company.id,
                role="cashier",
                is_default=False,
                is_active=False,
            )
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        companies = auth_service.get_companies_for_user(user.id)

        assert [company.id for company in companies] == [
            default_company.id,
            secondary_company.id,
        ]
        assert companies[0].role == "admin"
        assert companies[1].role == "manager"

    def test_create_owner_login_response_returns_owner_access_token(self, db_session):
        user = create_user(
            db_session,
            username="owner",
            email="owner@test.com",
            password="owner_password_123",
            global_role="super_admin",
            role="admin",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.create_owner_login_response(user)

        assert isinstance(result, OwnerLoginResponse)
        payload = decode_access_token(result.access_token)
        assert payload is not None
        assert payload["user_id"] == user.id
        assert payload["global_role"] == "super_admin"
        assert payload["token_type"] == OWNER_ACCESS_TOKEN_TYPE

    def test_create_super_admin_company_session_uses_virtual_company_access(
        self,
        db_session,
        default_company,
    ):
        user = create_user(
            db_session,
            username="owner",
            email="owner@test.com",
            password="owner_password_123",
            global_role="super_admin",
            role="admin",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.create_company_session(user, default_company.id)

        assert isinstance(result, CompanySession)
        assert result.current_company.id == default_company.id
        assert result.current_company.role == "admin"
        assert len(result.companies) == 1

        payload = decode_access_token(result.access_token)
        assert payload is not None
        assert payload["super_admin_entry"] is True

    def test_get_auth_session_supports_super_admin_company_entry(
        self,
        db_session,
        default_company,
    ):
        user = create_user(
            db_session,
            username="owner",
            email="owner@test.com",
            password="owner_password_123",
            global_role="super_admin",
            role="admin",
        )
        db_session.commit()

        auth_service = AuthService(db_session)
        result = auth_service.get_auth_session(
            user,
            default_company.id,
            current_role="admin",
            allow_super_admin_company=True,
        )

        assert isinstance(result, AuthSession)
        assert result.current_company.id == default_company.id
        assert result.current_company.role == "admin"
        assert len(result.companies) == 1

    def test_get_owner_session_returns_owner_user(self, db_session):
        user = create_user(
            db_session,
            username="owner",
            email="owner@test.com",
            password="owner_password_123",
            global_role="super_admin",
            role="admin",
        )
        db_session.commit()

        result = AuthService(db_session).get_owner_session(user)

        assert isinstance(result, OwnerSession)
        assert result.user.id == user.id
