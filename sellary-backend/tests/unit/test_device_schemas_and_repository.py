"""Unit tests for the device-auth schemas + repository (C2 part 2)."""
from datetime import datetime, timedelta, timezone

from models.cashier_device import CashierDevice
from repositories.cashier_device_repository import CashierDeviceRepository
from schemas.device import (
    DeviceListItem,
    DeviceRefreshRequest,
    DeviceRefreshResponse,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
)


class TestDeviceRegisterRequest:
    def test_defaults_are_none(self):
        request = DeviceRegisterRequest()
        assert request.name is None
        assert request.device_id is None

    def test_accepts_provided_values(self):
        request = DeviceRegisterRequest(name="Front counter", device_id="abc-123")
        assert request.name == "Front counter"
        assert request.device_id == "abc-123"


class TestDeviceRegisterResponse:
    def test_requires_device_id_and_token(self):
        response = DeviceRegisterResponse(device_id="abc-123", device_token="plaintext-token")
        assert response.device_id == "abc-123"
        assert response.device_token == "plaintext-token"
        assert response.name is None
        assert response.expires_at is None

    def test_accepts_optional_fields(self):
        expires_at = datetime.now(timezone.utc)
        response = DeviceRegisterResponse(
            device_id="abc-123",
            device_token="plaintext-token",
            name="Front counter",
            expires_at=expires_at,
        )
        assert response.name == "Front counter"
        assert response.expires_at == expires_at


class TestDeviceRefreshRequest:
    def test_requires_device_id_and_token(self):
        request = DeviceRefreshRequest(device_id="abc-123", device_token="plaintext-token")
        assert request.device_id == "abc-123"
        assert request.device_token == "plaintext-token"


class TestDeviceRefreshResponse:
    def test_defaults_token_type_to_bearer(self):
        response = DeviceRefreshResponse(access_token="jwt-value")
        assert response.access_token == "jwt-value"
        assert response.token_type == "bearer"
        assert response.expires_at is None

    def test_accepts_explicit_expires_at(self):
        expires_at = datetime.now(timezone.utc)
        response = DeviceRefreshResponse(access_token="jwt-value", expires_at=expires_at)
        assert response.expires_at == expires_at


class TestDeviceListItem:
    def test_from_attributes_reads_orm_instance(self, db_session, default_company, admin_user):
        device = CashierDevice(
            company_id=default_company.id,
            user_id=admin_user.id,
            device_id="abc-123",
            name="Front counter",
            token_hash="hash",
            is_active=True,
        )
        db_session.add(device)
        db_session.flush()
        db_session.refresh(device)

        item = DeviceListItem.model_validate(device)
        assert item.id == device.id
        assert item.device_id == "abc-123"
        assert item.name == "Front counter"
        assert item.is_active is True


class TestCashierDeviceRepository:
    def test_add_persists_and_assigns_id(self, db_session, default_company, admin_user):
        repo = CashierDeviceRepository(db_session)
        device = CashierDevice(
            company_id=default_company.id,
            user_id=admin_user.id,
            device_id="device-1",
            name="Register 1",
            token_hash="hash-1",
            is_active=True,
        )

        result = repo.add(device)

        assert result.id is not None
        assert result.device_id == "device-1"

    def test_get_by_device_id_returns_match(self, db_session, default_company, admin_user):
        repo = CashierDeviceRepository(db_session)
        repo.add(
            CashierDevice(
                company_id=default_company.id,
                user_id=admin_user.id,
                device_id="device-2",
                token_hash="hash-2",
                is_active=True,
            )
        )

        found = repo.get_by_device_id("device-2")
        missing = repo.get_by_device_id("does-not-exist")

        assert found is not None
        assert found.device_id == "device-2"
        assert missing is None

    def test_get_active_by_company_filters_inactive_and_other_companies(
        self, db_session, default_company, secondary_company, admin_user
    ):
        repo = CashierDeviceRepository(db_session)
        active = repo.add(
            CashierDevice(
                company_id=default_company.id,
                user_id=admin_user.id,
                device_id="device-active",
                token_hash="hash-active",
                is_active=True,
            )
        )
        repo.add(
            CashierDevice(
                company_id=default_company.id,
                user_id=admin_user.id,
                device_id="device-inactive",
                token_hash="hash-inactive",
                is_active=False,
            )
        )
        repo.add(
            CashierDevice(
                company_id=secondary_company.id,
                user_id=admin_user.id,
                device_id="device-other-company",
                token_hash="hash-other",
                is_active=True,
            )
        )

        results = repo.get_active_by_company(default_company.id)

        assert [d.id for d in results] == [active.id]

    def test_list_by_company_orders_by_created_at_desc(
        self, db_session, default_company, admin_user
    ):
        repo = CashierDeviceRepository(db_session)
        now = datetime.now(timezone.utc)
        older = repo.add(
            CashierDevice(
                company_id=default_company.id,
                user_id=admin_user.id,
                device_id="device-older",
                token_hash="hash-older",
                is_active=True,
                created_at=now - timedelta(days=1),
            )
        )
        newer = repo.add(
            CashierDevice(
                company_id=default_company.id,
                user_id=admin_user.id,
                device_id="device-newer",
                token_hash="hash-newer",
                is_active=True,
                created_at=now,
            )
        )

        results = repo.list_by_company(default_company.id)

        assert [d.id for d in results] == [newer.id, older.id]
