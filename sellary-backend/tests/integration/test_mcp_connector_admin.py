"""The AI connector as a module the owner controls.

Two things have to hold. The switch has to be a real switch — turning `ai` off
closes the door on tokens that were already issued, not just on new ones, since
those tokens live for a day. And the settings screen has to be tenant-scoped:
one company must not see, or cut off, another company's agents.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from fastmcp.exceptions import ToolError
from mcp.server.auth.provider import AccessToken

from mcp_server import SCOPE_PURCHASING, SCOPE_REPORTS
from mcp_server import context as mcp_context
from mcp_server import tools_reports
from models.company_module import CompanyModule
from models.oauth import OAuthClient, OAuthRefreshToken


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

    def rollback(self):
        pass


@pytest.fixture
def as_agent(monkeypatch, db_session):
    def _install(user, company):
        token = AccessToken(
            token="test-token",
            client_id="claude",
            scopes=[SCOPE_REPORTS, SCOPE_PURCHASING],
            subject=str(user.id),
            claims={
                "user_id": user.id,
                "company_id": company.id,
                "mcp": True,
                "scopes": [SCOPE_REPORTS, SCOPE_PURCHASING],
            },
        )
        monkeypatch.setattr(mcp_context, "get_access_token", lambda: token)
        monkeypatch.setattr(
            mcp_context, "SessionLocal", lambda: _SharedSession(db_session)
        )

    return _install


def _disable_connector(db_session, company):
    db_session.query(CompanyModule).filter(
        CompanyModule.company_id == company.id,
        CompanyModule.module == "ai",
    ).delete()
    db_session.flush()


def _connect_agent(db_session, company, user, *, client_id="claude", name="Claude"):
    if db_session.get(OAuthClient, client_id) is None:
        db_session.add(
            OAuthClient(
                client_id=client_id,
                client_name=name,
                redirect_uris=["https://claude.ai/api/mcp/auth_callback"],
                grant_types=["authorization_code", "refresh_token"],
                response_types=["code"],
                token_endpoint_auth_method="none",
            )
        )
    db_session.add(
        OAuthRefreshToken(
            token_hash=f"hash-{client_id}-{company.id}-{user.id}",
            client_id=client_id,
            user_id=user.id,
            company_id=company.id,
            scopes=["sellary:reports"],
            expires_at=datetime.now(timezone.utc) + timedelta(days=60),
        )
    )
    db_session.flush()


class TestTheSwitch:
    def test_a_tool_works_while_the_connector_is_on(
        self, as_agent, admin_user, default_company
    ):
        as_agent(admin_user, default_company)
        assert tools_reports.get_dashboard()["company"] == default_company.name

    def test_switching_it_off_stops_a_token_that_was_already_issued(
        self, as_agent, db_session, admin_user, default_company
    ):
        """The point of the switch. Access tokens live a day; a switch that only
        blocked new connections would leave the door open until then."""
        as_agent(admin_user, default_company)
        tools_reports.get_dashboard()  # works

        _disable_connector(db_session, default_company)

        with pytest.raises(ToolError) as exc:
            tools_reports.get_dashboard()
        assert "отключён" in str(exc.value)

    def test_it_stops_every_tool_not_just_the_reports_ones(
        self, as_agent, db_session, admin_user, default_company
    ):
        as_agent(admin_user, default_company)
        _disable_connector(db_session, default_company)
        with pytest.raises(ToolError):
            tools_reports.get_money_accounts()

    def test_the_message_says_who_can_turn_it_back_on(
        self, as_agent, db_session, admin_user, default_company
    ):
        as_agent(admin_user, default_company)
        _disable_connector(db_session, default_company)
        with pytest.raises(ToolError) as exc:
            tools_reports.get_dashboard()
        assert "владелец" in str(exc.value)


class TestConnectionEndpoint:
    def test_it_hands_back_the_url_to_paste(
        self, client: TestClient, admin_headers, default_company
    ):
        body = client.get("/api/mcp-connector/connection", headers=admin_headers).json()
        assert body["url"].endswith("/mcp")
        assert body["enabled"] is True
        assert body["company_name"] == default_company.name

    def test_it_is_closed_when_the_module_is_off(
        self, client: TestClient, db_session, admin_headers, default_company
    ):
        _disable_connector(db_session, default_company)
        response = client.get("/api/mcp-connector/connection", headers=admin_headers)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "module_not_enabled"


class TestAgentList:
    def test_a_connected_agent_is_listed_with_who_authorised_it(
        self, client: TestClient, db_session, admin_headers, admin_user, default_company
    ):
        _connect_agent(db_session, default_company, admin_user)
        agents = client.get("/api/mcp-connector/agents", headers=admin_headers).json()[
            "agents"
        ]
        assert len(agents) == 1
        assert agents[0]["client_name"] == "Claude"
        assert agents[0]["user_id"] == admin_user.id

    def test_nothing_is_listed_before_anyone_connects(
        self, client: TestClient, admin_headers
    ):
        body = client.get("/api/mcp-connector/agents", headers=admin_headers).json()
        assert body["agents"] == []

    def test_an_expired_grant_is_not_a_connection(
        self, client: TestClient, db_session, admin_headers, admin_user, default_company
    ):
        _connect_agent(db_session, default_company, admin_user)
        token = db_session.query(OAuthRefreshToken).one()
        token.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.flush()

        body = client.get("/api/mcp-connector/agents", headers=admin_headers).json()
        assert body["agents"] == []

    def test_another_company_s_agent_is_invisible(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        admin_user,
        default_company,
        secondary_company,
    ):
        _connect_agent(db_session, secondary_company, admin_user)
        body = client.get("/api/mcp-connector/agents", headers=admin_headers).json()
        assert body["agents"] == []


class TestRevoke:
    def test_revoking_removes_the_agent_from_the_list(
        self, client: TestClient, db_session, admin_headers, admin_user, default_company
    ):
        _connect_agent(db_session, default_company, admin_user)
        response = client.delete(
            f"/api/mcp-connector/agents/claude/{admin_user.id}", headers=admin_headers
        )
        assert response.status_code == 204

        body = client.get("/api/mcp-connector/agents", headers=admin_headers).json()
        assert body["agents"] == []

    def test_revoking_something_that_is_not_connected_is_a_404(
        self, client: TestClient, admin_headers, admin_user
    ):
        response = client.delete(
            f"/api/mcp-connector/agents/claude/{admin_user.id}", headers=admin_headers
        )
        assert response.status_code == 404

    def test_it_cannot_reach_across_companies(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        admin_user,
        default_company,
        secondary_company,
    ):
        """The same client id is shared by every tenant using the same product."""
        _connect_agent(db_session, secondary_company, admin_user)
        response = client.delete(
            f"/api/mcp-connector/agents/claude/{admin_user.id}", headers=admin_headers
        )
        assert response.status_code == 404

        surviving = (
            db_session.query(OAuthRefreshToken)
            .filter(OAuthRefreshToken.company_id == secondary_company.id)
            .one()
        )
        assert surviving.revoked_at is None
