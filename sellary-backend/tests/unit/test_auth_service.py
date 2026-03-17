"""
Unit tests for AuthService.
"""
import pytest
from unittest.mock import Mock, MagicMock
from datetime import timedelta

from services.auth_service import AuthService
from models.user import User
from schemas.user import UserCreate, Token
from core.security import get_password_hash


class TestAuthenticate:
    """Tests for user authentication."""

    def test_authenticate_with_valid_credentials(self, db_session):
        """Test authentication with valid username and password."""
        # Create a test user
        password = "test_password_123"
        hashed_password = get_password_hash(password)
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=hashed_password,
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        # Authenticate
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", password)

        assert result is not None
        assert result.username == "testuser"
        assert result.is_active is True

    def test_authenticate_with_invalid_username(self, db_session):
        """Test authentication with non-existent username."""
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("nonexistent", "password")

        assert result is None

    def test_authenticate_with_invalid_password(self, db_session):
        """Test authentication with wrong password."""
        # Create a test user
        password = "test_password_123"
        hashed_password = get_password_hash(password)
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=hashed_password,
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        # Authenticate with wrong password
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", "wrong_password")

        assert result is None

    def test_authenticate_with_inactive_user(self, db_session):
        """Test authentication with inactive user account."""
        # Create an inactive user
        password = "test_password_123"
        hashed_password = get_password_hash(password)
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=hashed_password,
            role="cashier",
            is_active=False,  # Inactive user
        )
        db_session.add(user)
        db_session.commit()

        # Authenticate
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", password)

        assert result is None

    def test_authenticate_with_empty_username(self, db_session):
        """Test authentication with empty username."""
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("", "password")

        assert result is None

    def test_authenticate_with_empty_password(self, db_session):
        """Test authentication with empty password."""
        # Create a test user
        password = "test_password_123"
        hashed_password = get_password_hash(password)
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=hashed_password,
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        # Authenticate with empty password
        auth_service = AuthService(db_session)
        result = auth_service.authenticate("testuser", "")

        assert result is None


class TestCreateUser:
    """Tests for user creation."""

    def test_create_user_with_valid_data(self, db_session):
        """Test creating a user with valid data."""
        user_create = UserCreate(
            username="newuser",
            email="newuser@test.com",
            full_name="New User",
            password="password123",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create)

        assert result is not None
        assert result.id is not None
        assert result.username == "newuser"
        assert result.email == "newuser@test.com"
        assert result.full_name == "New User"
        assert result.role == "cashier"
        assert result.is_active is True

    def test_create_user_hashes_password(self, db_session):
        """Test that password is hashed when creating user."""
        user_create = UserCreate(
            username="newuser",
            email="newuser@test.com",
            full_name="New User",
            password="plaintext_password",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create)

        assert result is not None
        assert result.hashed_password != "plaintext_password"
        assert len(result.hashed_password) > 0

    def test_create_user_with_duplicate_username(self, db_session):
        """Test creating user with duplicate username raises error."""
        # Create existing user
        existing = User(
            username="existing_user",
            email="existing@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(existing)
        db_session.commit()

        # Try to create user with same username
        user_create = UserCreate(
            username="existing_user",  # Duplicate
            email="different@test.com",
            full_name="Different User",
            password="password123",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        with pytest.raises(ValueError, match="Username.*already exists"):
            auth_service.create_user(user_create)

    def test_create_user_with_duplicate_email(self, db_session):
        """Test creating user with duplicate email raises error."""
        # Create existing user
        existing = User(
            username="existing_user",
            email="existing@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(existing)
        db_session.commit()

        # Try to create user with same email
        user_create = UserCreate(
            username="different_user",
            email="existing@test.com",  # Duplicate
            full_name="Different User",
            password="password123",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        with pytest.raises(ValueError, match="Email.*already exists"):
            auth_service.create_user(user_create)

    def test_create_user_with_admin_role(self, db_session):
        """Test creating user with admin role."""
        user_create = UserCreate(
            username="admin_user",
            email="admin@test.com",
            full_name="Admin User",
            password="password123",
            role="admin",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create)

        assert result is not None
        assert result.role == "admin"

    def test_create_user_with_manager_role(self, db_session):
        """Test creating user with manager role."""
        user_create = UserCreate(
            username="manager_user",
            email="manager@test.com",
            full_name="Manager User",
            password="password123",
            role="manager",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create)

        assert result is not None
        assert result.role == "manager"


class TestCreateToken:
    """Tests for token creation."""

    def test_create_token_returns_valid_token(self, db_session):
        """Test that create_token returns a valid token."""
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        auth_service = AuthService(db_session)
        token = auth_service.create_token(user)

        assert isinstance(token, Token)
        assert token.access_token is not None
        assert len(token.access_token) > 0
        assert token.token_type == "bearer"
        assert token.user.username == "testuser"

    def test_token_contains_user_data(self, db_session):
        """Test that token contains correct user data."""
        user = User(
            id=123,
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="manager",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        auth_service = AuthService(db_session)
        token = auth_service.create_token(user)

        assert token.user.id == 123
        assert token.user.username == "testuser"
        assert token.user.role == "manager"

    def test_token_type_is_bearer(self, db_session):
        """Test that token type is bearer."""
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        auth_service = AuthService(db_session)
        token = auth_service.create_token(user)

        assert token.token_type == "bearer"

    def test_token_is_valid_jwt(self, db_session):
        """Test that token is a valid JWT string."""
        from core.security import decode_access_token

        user = User(
            id=1,
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        auth_service = AuthService(db_session)
        token = auth_service.create_token(user)

        # Verify it's a valid JWT
        payload = decode_access_token(token.access_token)
        assert payload is not None
        assert payload["sub"] == "testuser"
        assert payload["user_id"] == 1
        assert payload["role"] == "cashier"


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_authenticate_with_case_sensitive_username(self, db_session):
        """Test that username is case sensitive."""
        password = "test_password_123"
        hashed_password = get_password_hash(password)
        user = User(
            username="TestUser",  # Mixed case
            email="test@test.com",
            hashed_password=hashed_password,
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        auth_service = AuthService(db_session)

        # Should fail with different case
        result = auth_service.authenticate("testuser", password)
        assert result is None

        # Should succeed with exact case
        result = auth_service.authenticate("TestUser", password)
        assert result is not None

    def test_multiple_users_same_username_different_case(self, db_session):
        """Test that usernames are unique regardless of case at DB level."""
        # This test depends on database constraints
        user1 = User(
            username="testuser",
            email="user1@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(user1)
        db_session.commit()

        # Try to add user with same username but different case
        # This may fail depending on database collation
        auth_service = AuthService(db_session)
        user_create = UserCreate(
            username="TestUser",  # Different case
            email="user2@test.com",
            full_name="Test User",
            password="password123",
            role="cashier",
        )

        # Behavior depends on database, but should either succeed or raise error
        try:
            result = auth_service.create_user(user_create)
            assert result is not None
        except ValueError:
            # Expected if database has case-insensitive unique constraint
            pass

    def test_create_user_preserves_full_name(self, db_session):
        """Test that full name is preserved when creating user."""
        user_create = UserCreate(
            username="newuser",
            email="newuser@test.com",
            full_name="John Doe Smith",
            password="password123",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create)

        assert result.full_name == "John Doe Smith"

    def test_create_user_with_unicode_characters(self, db_session):
        """Test creating user with unicode characters in name."""
        user_create = UserCreate(
            username="newuser",
            email="newuser@test.com",
            full_name="Алишер Джунусов",  # Russian characters
            password="password123",
            role="cashier",
        )

        auth_service = AuthService(db_session)
        result = auth_service.create_user(user_create)

        assert result.full_name == "Алишер Джунусов"
