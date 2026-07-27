"""The OAuth dance a connector performs to reach /mcp.

What matters is that the whole path works end to end without anyone pasting a
token, and that the three ways it could be subverted are closed: an
authorization code that works twice, a company the user does not belong to, and
an ordinary web-session token presented at the MCP endpoint.
"""

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.security import create_access_token
from main import app
from mcp_server.oauth import routes as routes_module
from mcp_server.oauth import store as store_module
from mcp_server.server import auth_provider

REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    return verifier, challenge


class _SharedSession:
    """The suite's session, immune to a caller closing or committing it."""

    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def commit(self):
        self._session.flush()

    def close(self):
        pass


@pytest.fixture
def oauth_client(monkeypatch, db_session, admin_user, default_company):
    """A TestClient whose OAuth layer reads and writes the suite's database."""
    factory = lambda: _SharedSession(db_session)  # noqa: E731
    monkeypatch.setattr(store_module, "SessionLocal", factory)
    monkeypatch.setattr(routes_module, "SessionLocal", factory)
    monkeypatch.setattr("core.database.SessionLocal", factory)

    app.dependency_overrides[get_db] = lambda: db_session
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def _register(client) -> dict:
    response = client.post(
        "/mcp/register",
        json={
            "client_name": "Claude",
            "redirect_uris": [REDIRECT_URI],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
    )
    assert response.status_code in (200, 201), response.text
    return response.json()


def _authorize(client, client_id: str, challenge: str) -> str:
    """Walk login -> company -> consent and return the authorization code."""
    response = client.get(
        "/mcp/authorize",
        params={
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": "xyz",
        },
        follow_redirects=False,
    )
    assert response.status_code in (302, 307), response.text
    txn = parse_qs(urlparse(response.headers["location"]).query)["txn"][0]

    response = client.post(
        "/mcp/oauth/login",
        data={"txn": txn, "username": "admin", "password": "testpassword123"},
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text
    txn = parse_qs(urlparse(response.headers["location"]).query)["txn"][0]

    response = client.post(
        "/mcp/oauth/consent",
        data={"txn": txn, "decision": "approve"},
        follow_redirects=False,
    )
    assert response.status_code == 302, response.text
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["state"] == ["xyz"]
    return query["code"][0]


def _exchange(client, client_id: str, code: str, verifier: str):
    return client.post(
        "/mcp/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
        },
    )


class TestDiscovery:
    def test_protected_resource_metadata_names_the_authorization_server(
        self, oauth_client
    ):
        response = oauth_client.get("/.well-known/oauth-protected-resource/mcp")
        assert response.status_code == 200
        body = response.json()
        assert body["resource"].endswith("/mcp")
        assert body["authorization_servers"]

    def test_authorization_server_metadata_advertises_pkce_and_registration(
        self, oauth_client
    ):
        response = oauth_client.get("/.well-known/oauth-authorization-server/mcp")
        assert response.status_code == 200
        body = response.json()
        assert body["code_challenge_methods_supported"] == ["S256"]
        assert body["registration_endpoint"].endswith("/register")

    def test_the_resource_identifier_carries_no_trailing_slash(self, oauth_client):
        """A one-character difference here is an audience mismatch."""
        body = oauth_client.get("/.well-known/oauth-protected-resource/mcp").json()
        assert not body["resource"].endswith("/mcp/")


class TestFullFlow:
    def test_a_connector_reaches_a_working_token_without_pasting_one(
        self, oauth_client, db_session, admin_user, default_company
    ):
        registration = _register(oauth_client)
        verifier, challenge = _pkce()
        code = _authorize(oauth_client, registration["client_id"], challenge)

        response = _exchange(oauth_client, registration["client_id"], code, verifier)
        assert response.status_code == 200, response.text
        tokens = response.json()
        assert tokens["token_type"].lower() == "bearer"
        assert tokens["refresh_token"]

        import asyncio

        access = asyncio.run(auth_provider.load_access_token(tokens["access_token"]))
        assert access is not None
        assert access.claims["company_id"] == default_company.id
        assert access.claims["user_id"] == admin_user.id
        assert access.claims["mcp"] is True

    def test_the_authorization_code_works_exactly_once(
        self, oauth_client, admin_user, default_company
    ):
        registration = _register(oauth_client)
        verifier, challenge = _pkce()
        code = _authorize(oauth_client, registration["client_id"], challenge)

        assert _exchange(
            oauth_client, registration["client_id"], code, verifier
        ).status_code == 200
        replayed = _exchange(oauth_client, registration["client_id"], code, verifier)
        assert replayed.status_code >= 400

    def test_a_wrong_pkce_verifier_is_rejected(
        self, oauth_client, admin_user, default_company
    ):
        registration = _register(oauth_client)
        _, challenge = _pkce()
        other_verifier, _ = _pkce()
        code = _authorize(oauth_client, registration["client_id"], challenge)

        response = _exchange(
            oauth_client, registration["client_id"], code, other_verifier
        )
        assert response.status_code >= 400

    def test_a_refresh_token_yields_a_new_access_token(
        self, oauth_client, admin_user, default_company
    ):
        registration = _register(oauth_client)
        verifier, challenge = _pkce()
        code = _authorize(oauth_client, registration["client_id"], challenge)
        tokens = _exchange(
            oauth_client, registration["client_id"], code, verifier
        ).json()

        response = oauth_client.post(
            "/mcp/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": tokens["refresh_token"],
                "client_id": registration["client_id"],
            },
        )
        assert response.status_code == 200, response.text
        refreshed = response.json()
        assert refreshed["access_token"]
        assert refreshed["refresh_token"] != tokens["refresh_token"], (
            "refresh tokens must rotate"
        )


class TestLoginPage:
    def test_a_bad_password_does_not_advance_the_flow(
        self, oauth_client, admin_user, default_company
    ):
        registration = _register(oauth_client)
        _, challenge = _pkce()
        response = oauth_client.get(
            "/mcp/authorize",
            params={
                "client_id": registration["client_id"],
                "redirect_uri": REDIRECT_URI,
                "response_type": "code",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        txn = parse_qs(urlparse(response.headers["location"]).query)["txn"][0]

        response = oauth_client.post(
            "/mcp/oauth/login",
            data={"txn": txn, "username": "admin", "password": "wrong"},
            follow_redirects=False,
        )
        assert response.status_code == 401
        assert "Неверный логин или пароль" in response.text

    def test_a_forged_transaction_is_refused(self, oauth_client):
        response = oauth_client.get("/mcp/oauth/login", params={"txn": "not-a-jwt"})
        assert response.status_code == 400

    def test_the_login_page_names_the_client_asking_for_access(
        self, oauth_client, admin_user, default_company
    ):
        registration = _register(oauth_client)
        _, challenge = _pkce()
        response = oauth_client.get(
            "/mcp/authorize",
            params={
                "client_id": registration["client_id"],
                "redirect_uri": REDIRECT_URI,
                "response_type": "code",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        txn = parse_qs(urlparse(response.headers["location"]).query)["txn"][0]
        page = oauth_client.get("/mcp/oauth/login", params={"txn": txn})
        assert page.status_code == 200
        assert "Claude" in page.text


class TestTokenSeparation:
    def test_an_ordinary_session_token_does_not_open_the_connector(self):
        """Web tokens and MCP tokens are the same shape but not interchangeable."""
        import asyncio

        session_token = create_access_token(
            data={"sub": "admin", "user_id": 1, "company_id": 1, "role": "admin"}
        )
        assert asyncio.run(auth_provider.load_access_token(session_token)) is None

    def test_a_token_missing_its_company_is_refused(self):
        import asyncio

        token = create_access_token(data={"sub": "admin", "user_id": 1, "mcp": True})
        assert asyncio.run(auth_provider.load_access_token(token)) is None
