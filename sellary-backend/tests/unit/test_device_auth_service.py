"""Unit tests for DeviceAuthService (C2 part 3): register/refresh/revoke/list."""
from datetime import datetime, timedelta, timezone

import pytest

from core.config import settings
from core.security import decode_access_token
from models.cashier_device import CashierDevice
from models.company_membership import CompanyMembership
from services.device_auth_service import DeviceAuthError, DeviceAuthService


class TestRegister:
    def test_register_returns_device_and_plaintext_token_once(
        self, db_session, default_company, cashier_user
    ):
        service = DeviceAuthService(db_session)

        device, token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1",
            device_id=None,
        )

        assert device.id is not None
        assert isinstance(token, str) and len(token) > 20
        # Only the hash is persisted -- the plaintext never touches the row.
        assert device.token_hash != token
        assert device.is_active is True
        assert device.company_id == default_company.id
        assert device.user_id == cashier_user.id
        assert device.expires_at is not None

    def test_register_enforces_one_device_per_shop(
        self, db_session, default_company, cashier_user
    ):
        service = DeviceAuthService(db_session)

        first_device, _first_token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1",
            device_id=None,
        )
        db_session.flush()
        second_device, _second_token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 2",
            device_id=None,
        )
        db_session.flush()

        active = (
            db_session.query(CashierDevice)
            .filter(
                CashierDevice.company_id == default_company.id,
                CashierDevice.is_active == True,  # noqa: E712
            )
            .all()
        )
        assert [d.id for d in active] == [second_device.id]

        refreshed_first = db_session.get(CashierDevice, first_device.id)
        assert refreshed_first.is_active is False

    def test_register_rotates_existing_row_when_device_id_matches(
        self, db_session, default_company, cashier_user
    ):
        service = DeviceAuthService(db_session)

        device, first_token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1",
            device_id=None,
        )
        db_session.flush()

        rotated, second_token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1 renamed",
            device_id=device.device_id,
        )

        assert rotated.id == device.id
        assert rotated.device_id == device.device_id
        assert rotated.is_active is True
        assert second_token != first_token
        assert rotated.name == "Kassa 1 renamed"


class TestRefresh:
    def _register(self, service, company_id, user_id):
        return service.register(
            company_id=company_id, user_id=user_id, name="Kassa 1", device_id=None
        )

    def test_refresh_rejects_bad_token(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, _token = self._register(service, default_company.id, cashier_user.id)
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh(device.device_id, "wrong-token")

        assert exc_info.value.status_code == 401

    def test_refresh_rejects_unknown_device_id(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh("does-not-exist", "whatever-token")

        assert exc_info.value.status_code == 401

    def test_refresh_rejects_inactive_device(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, token = self._register(service, default_company.id, cashier_user.id)
        device.is_active = False
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh(device.device_id, token)

        assert exc_info.value.status_code == 401

    def test_refresh_rejects_expired_device(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, token = self._register(service, default_company.id, cashier_user.id)
        device.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh(device.device_id, token)

        assert exc_info.value.status_code == 401

    def test_refresh_rejects_revoked_membership(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, token = self._register(service, default_company.id, cashier_user.id)
        db_session.flush()

        membership = (
            db_session.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == cashier_user.id,
                CompanyMembership.company_id == default_company.id,
            )
            .one()
        )
        membership.is_active = False
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh(device.device_id, token)

        assert exc_info.value.status_code == 403

    def test_refresh_rejects_disabled_user(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, token = self._register(service, default_company.id, cashier_user.id)
        db_session.flush()

        cashier_user.is_active = False
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh(device.device_id, token)

        assert exc_info.value.status_code == 403

    def test_refresh_rejects_deactivated_company(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, token = self._register(service, default_company.id, cashier_user.id)
        db_session.flush()

        default_company.is_active = False
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh(device.device_id, token)

        assert exc_info.value.status_code == 403

    def test_refresh_mints_valid_24h_access_token_and_slides_expiry(
        self, db_session, default_company, cashier_user
    ):
        service = DeviceAuthService(db_session)
        device, token = self._register(service, default_company.id, cashier_user.id)
        db_session.flush()

        original_expires_at = device.expires_at
        assert device.last_seen_at is None

        access_token, new_expires_at = service.refresh(device.device_id, token)

        payload = decode_access_token(access_token)
        assert payload is not None
        assert payload["token_type"] == "access"
        assert payload["user_id"] == cashier_user.id
        assert payload["company_id"] == default_company.id
        assert payload["sub"] == cashier_user.username
        assert payload["device_id"] == device.device_id

        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        now = datetime.now(timezone.utc)
        # Same TTL as every other access_token (settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        # 24h by default) -- allow a few minutes of slack for test execution time.
        expected_ttl = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        assert expected_ttl - timedelta(minutes=5) < (exp - now) < expected_ttl + timedelta(minutes=5)

        assert device.last_seen_at is not None
        assert new_expires_at > original_expires_at
        assert device.expires_at == new_expires_at

    def test_refresh_is_constant_time_safe_for_missing_device(self, db_session):
        """Missing device must raise the same 401 as a bad token, no timing oracle."""
        service = DeviceAuthService(db_session)

        with pytest.raises(DeviceAuthError) as exc_info:
            service.refresh("totally-unknown-device", "some-token-value")

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid device credentials"


class TestRevoke:
    def test_revoke_sets_inactive(self, db_session, default_company, cashier_user):
        service = DeviceAuthService(db_session)
        device, _token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1",
            device_id=None,
        )
        db_session.flush()

        revoked = service.revoke(default_company.id, device.device_id)

        assert revoked.is_active is False
        refreshed = db_session.get(CashierDevice, device.id)
        assert refreshed.is_active is False

    def test_revoke_raises_404_for_unknown_device(self, db_session, default_company):
        service = DeviceAuthService(db_session)

        with pytest.raises(DeviceAuthError) as exc_info:
            service.revoke(default_company.id, "does-not-exist")

        assert exc_info.value.status_code == 404

    def test_revoke_raises_404_for_device_belonging_to_another_company(
        self, db_session, default_company, secondary_company, cashier_user
    ):
        service = DeviceAuthService(db_session)
        device, _token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1",
            device_id=None,
        )
        db_session.flush()

        with pytest.raises(DeviceAuthError) as exc_info:
            service.revoke(secondary_company.id, device.device_id)

        assert exc_info.value.status_code == 404


class TestListDevices:
    def test_list_devices_returns_all_for_company(
        self, db_session, default_company, secondary_company, cashier_user
    ):
        service = DeviceAuthService(db_session)
        device, _token = service.register(
            company_id=default_company.id,
            user_id=cashier_user.id,
            name="Kassa 1",
            device_id=None,
        )
        db_session.flush()
        service.revoke(default_company.id, device.device_id)
        other_device, _other_token = service.register(
            company_id=secondary_company.id,
            user_id=cashier_user.id,
            name="Kassa Other",
            device_id=None,
        )
        db_session.flush()

        results = service.list_devices(default_company.id)

        assert [d.id for d in results] == [device.id]
        assert other_device.id not in [d.id for d in results]
