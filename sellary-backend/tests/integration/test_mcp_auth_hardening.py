"""Regression coverage for delegated access and OAuth failure paths."""

import asyncio
import threading
from unittest.mock import patch

import pytest
import httpx
from cryptography.fernet import Fernet
from fastmcp.exceptions import ToolError
from mcp.server.auth.provider import AccessToken, TokenError

from core.config import settings
from core.rate_limiter import RateLimiter
from core.security import create_access_token
from mcp_server import context, tools_reports
from mcp_server.oauth import routes, store
from mcp_server.oauth.transaction import encode_txn
from mcp_server.server import auth_provider
from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess
from models.oauth import OAuthClient, OAuthRefreshToken
from services.mcp_admin_service import McpAdminService
from tests.integration.test_mcp_oauth_flow import (
    _SharedSession,
    _authorize,
    _exchange,
    _pkce,
    _register,
    oauth_client,
)


class _ToolSession(_SharedSession):
    def rollback(self):
        pass


@pytest.mark.parametrize("endpoint", ["/api/auth/me", "/api/auth/refresh", "/api/auth/switch-company"])
def test_legacy_mcp_token_cannot_open_rest(
    client, admin_user, default_company, endpoint
):
    token = create_access_token(data={
        "user_id": admin_user.id, "company_id": default_company.id,
        "mcp": True, "scopes": ["sellary:reports"],
    })
    headers = {"Authorization": f"Bearer {token}"}
    response = (
        client.get(endpoint, headers=headers)
        if endpoint.endswith("/me")
        else client.post(endpoint, headers=headers, json={"company_id": default_company.id})
    )
    assert response.status_code == 401


def test_mcp_checks_member_ai_grant_on_every_call(
    monkeypatch, db_session, manager_user, default_company
):
    token = AccessToken(token="test", client_id="test", scopes=["sellary:reports"], claims={
        "user_id": manager_user.id, "company_id": default_company.id, "mcp": True,
    })
    monkeypatch.setattr(context, "get_access_token", lambda: token)
    monkeypatch.setattr(context, "SessionLocal", lambda: _ToolSession(db_session))
    assert tools_reports.get_current_shift()["is_open"] is True
    membership = db_session.query(CompanyMembership).filter_by(
        user_id=manager_user.id, company_id=default_company.id
    ).one()
    db_session.query(MembershipModuleAccess).filter_by(
        membership_id=membership.id, module="ai"
    ).delete()
    db_session.flush()
    assert routes._companies_for(db_session, manager_user.id) == []
    with pytest.raises(ToolError, match="ИИ-коннектор"):
        tools_reports.get_current_shift()


def test_replaying_login_transaction_is_throttled(oauth_client, monkeypatch):
    limiter = RateLimiter(max_attempts=3, window_seconds=60)
    monkeypatch.setattr(routes, "login_rate_limiter", limiter, raising=False)
    txn = encode_txn({"client_name": "test", "attempts": 0})
    statuses = [oauth_client.post("/mcp/oauth/login", data={
        "txn": txn, "username": "admin", "password": "wrong",
    }).status_code for _ in range(5)]
    assert statuses == [401, 401, 401, 429, 429]
    fresh = encode_txn({"client_name": "another", "attempts": 0})
    assert oauth_client.post("/mcp/oauth/login", data={
        "txn": fresh, "username": "admin", "password": "wrong",
    }).status_code == 429


def test_undecryptable_secret_rejects_confidential_client(
    oauth_client, db_session
):
    db_session.add(OAuthClient(
        client_id="old-confidential", client_secret_enc=Fernet(Fernet.generate_key()).encrypt(b"old-secret").decode(),
        client_name="Old client", redirect_uris=["https://client.example/callback"],
        grant_types=["authorization_code", "refresh_token"], response_types=["code"],
        token_endpoint_auth_method="client_secret_post",
    ))
    db_session.flush()
    assert store.get_client("old-confidential") is None
    response = oauth_client.post("/mcp/token", data={
        "client_id": "old-confidential", "grant_type": "refresh_token", "refresh_token": "missing",
    })
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_client"


def _tokens(client):
    registration = _register(client)
    verifier, challenge = _pkce()
    code = _authorize(client, registration["client_id"], challenge)
    return registration, _exchange(client, registration["client_id"], code, verifier).json()


def test_new_mcp_token_is_resource_bound(oauth_client):
    _, tokens = _tokens(oauth_client)
    access = asyncio.run(auth_provider.load_access_token(tokens["access_token"]))
    assert access is not None
    assert access.claims["token_type"] == "mcp_access"
    assert access.claims["aud"] == settings.MCP_PUBLIC_BASE_URL.rstrip("/") + "/mcp"
    assert access.scopes == ["sellary:reports", "sellary:records", "sellary:purchasing"]
    assert oauth_client.get("/api/auth/me", headers={
        "Authorization": f"Bearer {tokens['access_token']}",
    }).status_code == 401


def test_existing_mcp_access_token_remains_usable(admin_user, default_company):
    token = create_access_token(data={
        "user_id": admin_user.id, "company_id": default_company.id, "mcp": True,
        "scopes": ["sellary:reports"],
    })
    assert asyncio.run(auth_provider.load_access_token(token)) is not None


def test_mcp_token_with_wrong_audience_is_refused(admin_user, default_company):
    token = create_access_token(data={
        "user_id": admin_user.id, "company_id": default_company.id, "mcp": True,
        "aud": "https://other.example/mcp",
    }, token_type="mcp_access")
    assert asyncio.run(auth_provider.load_access_token(token)) is None


def test_disabled_member_refresh_returns_oauth_error(
    oauth_client, db_session, admin_user, default_company
):
    registration, tokens = _tokens(oauth_client)
    membership = db_session.query(CompanyMembership).filter_by(
        user_id=admin_user.id, company_id=default_company.id
    ).one()
    membership.is_active = False
    db_session.flush()
    response = oauth_client.post("/mcp/token", data={
        "grant_type": "refresh_token", "client_id": registration["client_id"],
        "refresh_token": tokens["refresh_token"],
    })
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_grant"


def test_refresh_token_is_not_consumed_when_issuance_fails(
    oauth_client, db_session
):
    registration, tokens = _tokens(oauth_client)
    with patch.object(auth_provider, "_issue_tokens", side_effect=RuntimeError("temporary failure")):
        with pytest.raises(RuntimeError, match="temporary failure"):
            oauth_client.post("/mcp/token", data={
                "grant_type": "refresh_token", "client_id": registration["client_id"],
                "refresh_token": tokens["refresh_token"],
            })
    assert store.peek_refresh_token(tokens["refresh_token"]) is not None


def test_revocation_requeries_grants_after_waiting_for_rotation(
    oauth_client, db_session, monkeypatch, admin_user, default_company
):
    """Simulate a rotation finishing while revocation waits for its client lock."""
    registration, tokens = _tokens(oauth_client)
    grant = store.peek_refresh_token(tokens["refresh_token"])
    replacement = "replacement-from-concurrent-refresh"

    def finish_rotation(db, client_id):
        old = db.get(OAuthRefreshToken, store.hash_secret(tokens["refresh_token"]))
        db.delete(old)
        db.flush()
        store.save_refresh_token(replacement, grant, db=db)
        return True

    monkeypatch.setattr(store, "lock_client", finish_rotation, raising=False)
    struck = McpAdminService(db_session, default_company.id).revoke(
        registration["client_id"], admin_user.id
    )
    assert struck == 1
    replacement_row = db_session.get(OAuthRefreshToken, store.hash_secret(replacement))
    assert replacement_row is not None
    assert replacement_row.revoked_at is not None
    assert store.peek_refresh_token(replacement) is None


def test_refresh_rechecks_revocation_after_waiting_for_client_lock(
    oauth_client, db_session, monkeypatch
):
    """Simulate revocation committing before the waiting refresh acquires its lock."""
    _, tokens = _tokens(oauth_client)

    def finish_revocation(db, client_id):
        row = db.get(OAuthRefreshToken, store.hash_secret(tokens["refresh_token"]))
        row.revoked_at = store._utcnow()
        db.flush()
        return True

    def issue(db, grant):
        if grant is None:
            raise TokenError("invalid_grant", "Refresh grant was revoked")
        store.save_refresh_token("unauthorized-replacement", grant, db=db)
        return "unauthorized-replacement"

    monkeypatch.setattr(store, "lock_client", finish_revocation, raising=False)
    with pytest.raises(TokenError, match="revoked"):
        store.rotate_refresh_token(tokens["refresh_token"], issue)
    assert db_session.get(
        OAuthRefreshToken, store.hash_secret("unauthorized-replacement")
    ) is None


def test_oauth_authentication_runs_outside_event_loop(
    oauth_client, monkeypatch
):
    from services.auth_service import AuthService
    original = AuthService.authenticate
    loop_threads = []
    auth_threads = []
    original_decode = routes.decode_txn
    def decode(txn):
        loop_threads.append(threading.get_ident())
        return original_decode(txn)
    def authenticate(self, username, password):
        auth_threads.append(threading.get_ident())
        return original(self, username, password)
    monkeypatch.setattr(routes, "decode_txn", decode)
    monkeypatch.setattr(AuthService, "authenticate", authenticate)
    response = oauth_client.post("/mcp/oauth/login", data={
        "txn": encode_txn({"client_name": "test", "attempts": 0}),
        "username": "admin", "password": "wrong",
    })
    assert response.status_code == 401
    assert auth_threads[0] != loop_threads[0]


def test_agent_list_groups_reconnections(oauth_client, db_session, admin_user, default_company):
    _tokens(oauth_client)
    registration = db_session.query(OAuthClient).one()
    store.save_refresh_token("another-grant", store.GrantRecord(
        client_id=registration.client_id, user_id=admin_user.id, company_id=default_company.id,
        scopes=["sellary:reports"],
    ))
    agents = McpAdminService(db_session, default_company.id).agents().agents
    assert len(agents) == 1
    assert agents[0].scopes == ["sellary:reports", "sellary:records", "sellary:purchasing"]


def test_connection_is_disabled_when_server_connector_is_disabled(
    monkeypatch, db_session, default_company
):
    monkeypatch.setattr(settings, "MCP_ENABLED", False)
    connection = McpAdminService(db_session, default_company.id).connection()
    assert connection.enabled is False


def test_settings_and_health_report_connector_mount_failure(
    client, monkeypatch, admin_headers
):
    from main import app
    monkeypatch.setattr(app.state, "mcp_available", False)
    response = client.get("/api/mcp-connector/connection", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["enabled"] is False
    assert response.json()["available"] is False
    assert client.get("/health").json()["mcp"]["available"] is False


@pytest.mark.asyncio
async def test_account_throttle_survives_different_peers(oauth_client, monkeypatch):
    from main import app
    monkeypatch.setattr(routes, "login_rate_limiter", RateLimiter(max_attempts=3))
    txn = encode_txn({"client_name": "test", "attempts": 0})
    statuses = []
    for number in range(4):
        transport = httpx.ASGITransport(app=app, client=(f"198.51.100.{number + 1}", 443))
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post("/mcp/oauth/login", data={
                "txn": txn, "username": "admin", "password": "wrong",
            })
            statuses.append(response.status_code)
    assert statuses == [401, 401, 401, 429]


def test_forwarded_header_cannot_reset_ip_throttle(oauth_client, monkeypatch):
    monkeypatch.setattr(routes, "login_rate_limiter", RateLimiter(max_attempts=3))
    txn = encode_txn({"client_name": "test", "attempts": 0})
    statuses = [oauth_client.post("/mcp/oauth/login", data={
        "txn": txn, "username": f"unknown-{number}", "password": "wrong",
    }, headers={"X-Forwarded-For": f"198.51.100.{number}"}).status_code for number in range(4)]
    assert statuses == [401, 401, 401, 429]
