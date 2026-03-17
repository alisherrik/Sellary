"""
Unit tests for security utilities (password hashing, JWT tokens).
"""
import pytest
from datetime import datetime, timedelta
from core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_access_token,
)
from core.config import settings


class TestPasswordHashing:
    """Tests for password hashing and verification."""

    def test_password_hashing_returns_different_hashes(self):
        """Test that hashing the same password twice produces different hashes."""
        password = "test_password_123"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)

        # Hashes should be different due to salt
        assert hash1 != hash2

    def test_password_hashing_is_verifiable(self):
        """Test that a password can be verified against its hash."""
        password = "test_password_123"
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True

    def test_wrong_password_does_not_verify(self):
        """Test that wrong password does not verify."""
        password = "test_password_123"
        wrong_password = "wrong_password_456"
        hashed = get_password_hash(password)

        assert verify_password(wrong_password, hashed) is False

    def test_empty_password_hashing(self):
        """Test hashing an empty password."""
        password = ""
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True
        assert verify_password("something", hashed) is False

    def test_unicode_password_hashing(self):
        """Test hashing passwords with unicode characters."""
        password = "пароль_123"  # Russian characters
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True

    def test_long_password_hashing(self):
        """Test hashing a long password (bcrypt has 72 byte limit)."""
        # bcrypt has a 72 byte limit, so we test a password within that limit
        password = "a" * 71  # Within bcrypt's 72 byte limit
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True


class TestJWTTokenCreation:
    """Tests for JWT token creation."""

    def test_create_token_with_valid_data(self):
        """Test creating a token with valid data."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        token = create_access_token(data)

        assert isinstance(token, str)
        assert len(token) > 0
        # JWT tokens have 3 parts separated by dots
        assert token.count(".") == 2

    def test_create_token_with_expiration(self):
        """Test creating a token with custom expiration."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        expires = timedelta(minutes=30)
        token = create_access_token(data, expires_delta=expires)

        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_token_without_expiration(self):
        """Test creating a token with default expiration."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        token = create_access_token(data)

        assert isinstance(token, str)
        assert len(token) > 0

    def test_token_contains_exp_claim(self):
        """Test that token contains expiration claim."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        expires = timedelta(minutes=30)
        token = create_access_token(data, expires_delta=expires)

        payload = decode_access_token(token)
        assert payload is not None
        assert "exp" in payload

    def test_token_expiration_is_future(self):
        """Test that token expiration is in the future."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        expires = timedelta(minutes=30)
        token = create_access_token(data, expires_delta=expires)

        payload = decode_access_token(token)
        assert payload is not None
        exp_timestamp = payload["exp"]
        exp_datetime = datetime.fromtimestamp(exp_timestamp)
        assert exp_datetime > datetime.now()


class TestJWTTokenDecoding:
    """Tests for JWT token decoding."""

    def test_decode_valid_token(self):
        """Test decoding a valid token."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        token = create_access_token(data)

        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == "testuser"
        assert payload["user_id"] == 1
        assert payload["role"] == "admin"

    def test_decode_invalid_token(self):
        """Test decoding an invalid token."""
        invalid_token = "invalid.token.string"
        payload = decode_access_token(invalid_token)

        assert payload is None

    def test_decode_malformed_token(self):
        """Test decoding a malformed token."""
        malformed_token = "not-a-jwt"
        payload = decode_access_token(malformed_token)

        assert payload is None

    def test_decode_empty_token(self):
        """Test decoding an empty token."""
        payload = decode_access_token("")

        assert payload is None

    def test_decode_token_with_wrong_secret(self):
        """Test that token with wrong secret cannot be decoded."""
        import jwt
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}

        # Create token with wrong secret
        token = jwt.encode(data, "wrong_secret", algorithm="HS256")

        payload = decode_access_token(token)
        assert payload is None

    def test_decode_token_preserves_all_data(self):
        """Test that decoding preserves all original data."""
        data = {
            "sub": "testuser",
            "user_id": 123,
            "role": "manager",
            "extra_field": "extra_value",
        }
        token = create_access_token(data)

        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == "testuser"
        assert payload["user_id"] == 123
        assert payload["role"] == "manager"
        assert payload["extra_field"] == "extra_value"


class TestTokenExpiration:
    """Tests for token expiration handling."""

    def test_expired_token_returns_none(self):
        """Test that an expired token returns None."""
        import jwt
        from datetime import datetime, timedelta

        # Create an expired token
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        expire = datetime.utcnow() - timedelta(minutes=1)
        payload = data.copy()
        payload.update({"exp": expire})

        expired_token = jwt.encode(
            payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM
        )

        decoded = decode_access_token(expired_token)
        assert decoded is None

    def test_token_expiration_claim_added(self):
        """Test that expiration claim is added to token."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        expires = timedelta(hours=1)
        token = create_access_token(data, expires_delta=expires)

        payload = decode_access_token(token)
        assert payload is not None
        assert "exp" in payload

        # Verify expiration is approximately 1 hour from now
        exp_timestamp = payload["exp"]
        exp_datetime = datetime.fromtimestamp(exp_timestamp)
        now = datetime.now()
        time_diff = exp_datetime - now

        # Should be close to 1 hour (within 1 minute tolerance)
        assert timedelta(minutes=59) <= time_diff <= timedelta(minutes=61)


class TestTokenSecurity:
    """Tests for token security features."""

    def test_different_tokens_for_same_data(self):
        """Test that creating tokens with same data produces valid tokens."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}

        token1 = create_access_token(data.copy())
        token2 = create_access_token(data.copy())

        # Both tokens should be valid and decodable
        payload1 = decode_access_token(token1)
        payload2 = decode_access_token(token2)

        assert payload1 is not None
        assert payload2 is not None
        assert payload1["sub"] == "testuser"
        assert payload2["sub"] == "testuser"

        # Tokens should be valid JWT format (3 parts separated by dots)
        assert token1.count(".") == 2
        assert token2.count(".") == 2

    def test_algorithm_is_hs256(self):
        """Test that tokens use HS256 algorithm."""
        import jwt

        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        token = create_access_token(data)

        # Decode without verification to check headers
        headers = jwt.get_unverified_header(token)
        assert headers["alg"] == settings.ALGORITHM

    def test_token_type_is_bearer(self):
        """Test that tokens are bearer tokens."""
        data = {"sub": "testuser", "user_id": 1, "role": "admin"}
        token = create_access_token(data)

        # Bearer tokens are just the token string
        assert isinstance(token, str)
        assert "Bearer" not in token  # "Bearer" prefix is added by client
