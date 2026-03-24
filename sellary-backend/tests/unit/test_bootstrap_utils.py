from bootstrap_utils import ensure_super_admin
from core.security import verify_password
from models.user import User


class TestEnsureSuperAdmin:
    def test_returns_none_when_env_values_missing(self, db_session, monkeypatch):
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_USERNAME", None)
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_EMAIL", None)
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_PASSWORD", None)
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_FULL_NAME", None)

        result = ensure_super_admin(db_session)

        assert result is None

    def test_creates_super_admin_when_env_values_present(self, db_session, monkeypatch):
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_USERNAME", "owner")
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_EMAIL", "owner@example.com")
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_PASSWORD", "owner123")
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_FULL_NAME", "App Owner")

        result = ensure_super_admin(db_session)

        assert result is not None
        user, created = result
        assert created is True
        assert user.global_role == "super_admin"
        assert user.role == "admin"
        assert user.is_active is True
        assert verify_password("owner123", user.hashed_password) is True

    def test_updates_existing_super_admin(self, db_session, monkeypatch):
        existing = User(
            username="old-owner",
            email="old-owner@example.com",
            full_name="Old Owner",
            hashed_password="old-hash",
            role="cashier",
            global_role="standard",
            is_active=False,
        )
        db_session.add(existing)
        db_session.flush()

        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_USERNAME", "old-owner")
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_EMAIL", "owner@example.com")
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_PASSWORD", "owner123")
        monkeypatch.setattr("bootstrap_utils.settings.SUPER_ADMIN_FULL_NAME", "Updated Owner")

        result = ensure_super_admin(db_session)

        assert result is not None
        user, created = result
        assert created is False
        assert user.id == existing.id
        assert user.email == "owner@example.com"
        assert user.full_name == "Updated Owner"
        assert user.global_role == "super_admin"
        assert user.role == "admin"
        assert user.is_active is True
        assert verify_password("owner123", user.hashed_password) is True
