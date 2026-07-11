"""Integration tests for the cashier device-auth endpoints (C2)."""
from datetime import datetime, timedelta, timezone

from core.security import decode_access_token
from tests.conftest import create_auth_headers


def _register(client, headers, name="Kassa 1", device_id=None):
    body = {"name": name}
    if device_id is not None:
        body["device_id"] = device_id
    return client.post("/api/auth/devices/register", json=body, headers=headers)


class TestDeviceRegister:
    def test_cashier_can_self_register_and_get_token_once(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        resp = _register(client, headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["device_id"]
        assert data["device_token"]  # plaintext, once
        assert data["expires_at"] is not None

    def test_register_enforces_one_device_per_shop(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        first = _register(client, headers).json()
        _register(client, headers)  # second registration

        active = (
            db_session.query(CashierDevice)
            .filter(
                CashierDevice.company_id == default_company.id,
                CashierDevice.is_active == True,  # noqa: E712
            )
            .all()
        )
        assert len(active) == 1
        first_row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == first["device_id"])
            .one()
        )
        assert first_row.is_active is False


class TestDeviceRefresh:
    def test_refresh_mints_access_token_and_slides_expiry(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()

        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 200
        data = resp.json()
        payload = decode_access_token(data["access_token"])
        assert payload is not None
        assert payload["token_type"] == "access"
        assert payload["user_id"] == cashier_user.id
        assert payload["company_id"] == default_company.id
        assert payload["role"] == "cashier"
        assert payload["device_id"] == reg["device_id"]

        row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == reg["device_id"])
            .one()
        )
        assert row.last_seen_at is not None

    def test_refresh_rejects_bad_token(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": "wrong-token"},
        )
        assert resp.status_code == 401

    def test_refresh_rejects_inactive_device(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == reg["device_id"])
            .one()
        )
        row.is_active = False
        db_session.flush()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 401

    def test_refresh_rejects_expired_device(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == reg["device_id"])
            .one()
        )
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.flush()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 401

    def test_refresh_rejects_revoked_membership_with_403(
        self, client, db_session, default_company, cashier_user
    ):
        from models.company_membership import CompanyMembership

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
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
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 403

    def test_refresh_rate_limited(
        self, client, db_session, default_company, cashier_user, monkeypatch
    ):
        import api.device_auth as device_auth_module

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        monkeypatch.setattr(
            device_auth_module.login_rate_limiter, "is_rate_limited", lambda key: True
        )
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 429


class TestDeviceRevokeAndList:
    def test_admin_can_revoke_and_list(
        self, client, db_session, default_company, admin_user, cashier_user
    ):
        cashier_headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, cashier_headers).json()

        admin_headers = create_auth_headers(
            admin_user.username, admin_user.id,
            default_company.id, admin_user.role,
        )
        listed = client.get("/api/auth/devices", headers=admin_headers)
        assert listed.status_code == 200
        assert any(d["device_id"] == reg["device_id"] for d in listed.json())

        revoked = client.delete(
            f"/api/auth/devices/{reg['device_id']}", headers=admin_headers
        )
        assert revoked.status_code == 200

        # Refresh now fails because the device is inactive.
        after = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert after.status_code == 401

    def test_cashier_cannot_revoke(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        resp = client.delete(
            f"/api/auth/devices/{reg['device_id']}", headers=headers
        )
        assert resp.status_code == 403
