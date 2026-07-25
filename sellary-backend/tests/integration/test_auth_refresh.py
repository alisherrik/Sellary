"""Sliding session: /auth/refresh renews a live token without a new login."""

from datetime import datetime, timedelta, timezone

from core.config import settings
from core.security import create_access_token, decode_access_token


class TestAuthRefresh:
    def test_refresh_returns_a_working_session(self, client, cashier_headers):
        resp = client.post("/api/auth/refresh", headers=cashier_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"]
        assert body["current_company"]["id"]

        # The new token opens the same doors as the old one.
        fresh = {"Authorization": f"Bearer {body['access_token']}"}
        assert client.get("/api/auth/me", headers=fresh).status_code == 200

    def test_refresh_carries_the_original_session_start(self, client, cashier_headers):
        first = client.post("/api/auth/refresh", headers=cashier_headers).json()
        started = decode_access_token(first["access_token"])["ses"]

        second = client.post(
            "/api/auth/refresh",
            headers={"Authorization": f"Bearer {first['access_token']}"},
        ).json()
        # A renewed session keeps its original start, which is what makes the
        # absolute cap enforceable without storing anything.
        assert decode_access_token(second["access_token"])["ses"] == started

    def test_refresh_refuses_past_the_absolute_cap(self, client, cashier_user, default_company):
        long_ago = datetime.now(timezone.utc) - timedelta(
            days=settings.SESSION_ABSOLUTE_MAX_DAYS + 1
        )
        stale = create_access_token(
            data={
                "sub": cashier_user.username,
                "user_id": cashier_user.id,
                "company_id": default_company.id,
                "role": "cashier",
                "global_role": cashier_user.global_role,
                "ses": int(long_ago.timestamp()),
            }
        )
        resp = client.post(
            "/api/auth/refresh", headers={"Authorization": f"Bearer {stale}"}
        )
        assert resp.status_code == 401

    def test_refresh_requires_a_token(self, client):
        assert client.post("/api/auth/refresh").status_code in (401, 403)
