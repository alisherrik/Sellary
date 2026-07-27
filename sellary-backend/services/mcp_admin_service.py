"""What the owner sees and can do about the AI connector.

The connector's own tables live under `mcp_server/`, but this is an ordinary
tenant-scoped feature: an admin opens Settings, copies a URL, sees who has
connected, and cuts one of them off. So it sits in `services/` with everything
else and is reached through the normal company-scoped API.

Revoking is the reason this exists. A connected agent holds an access token
that is valid for a day; deleting its refresh token stops it renewing, and the
`ai` module switch is what closes the door before then.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from core.config import settings
from models.company import Company
from models.oauth import OAuthClient, OAuthRefreshToken
from models.user import User
from repositories.company_module_repository import CompanyModuleRepository
from schemas.mcp import McpAgent, McpAgentList, McpConnection
from services.tenant import resolve_company_id

CONNECTOR_MODULE = "ai"


class McpAdminService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def connection(self) -> McpConnection:
        company = self.db.get(Company, self.company_id)
        return McpConnection(
            url=f"{settings.MCP_PUBLIC_BASE_URL.rstrip('/')}/mcp",
            enabled=CompanyModuleRepository(self.db).has_module(
                self.company_id, CONNECTOR_MODULE
            ),
            company_name=company.name if company else "",
        )

    def agents(self) -> McpAgentList:
        """Who is currently connected, newest first.

        Read from live refresh tokens: an access token alone expires within a
        day, so a grant that can no longer be renewed is not a connection any
        more and should stop being listed.
        """
        now = datetime.now(timezone.utc)
        rows = (
            self.db.query(OAuthRefreshToken, OAuthClient, User)
            .outerjoin(
                OAuthClient, OAuthClient.client_id == OAuthRefreshToken.client_id
            )
            .outerjoin(User, User.id == OAuthRefreshToken.user_id)
            .filter(
                OAuthRefreshToken.company_id == self.company_id,
                OAuthRefreshToken.revoked_at.is_(None),
            )
            .order_by(OAuthRefreshToken.created_at.desc())
            .all()
        )

        agents: list[McpAgent] = []
        for token, client, user in rows:
            expires_at = _aware(token.expires_at)
            if expires_at is not None and expires_at <= now:
                continue
            agents.append(
                McpAgent(
                    client_id=token.client_id,
                    client_name=client.client_name if client else None,
                    user_id=token.user_id,
                    user_name=(user.full_name or user.username) if user else "—",
                    connected_at=_aware(token.created_at) or now,
                    expires_at=expires_at or now,
                    scopes=list(token.scopes or []),
                )
            )
        return McpAgentList(agents=agents)

    def revoke(self, client_id: str, user_id: int) -> int:
        """Cut one agent off for one user. Returns how many grants were struck.

        Scoped to this company: the same client id is shared by every tenant
        that connected the same product, and revoking must not reach across.
        """
        rows = (
            self.db.query(OAuthRefreshToken)
            .filter(
                OAuthRefreshToken.company_id == self.company_id,
                OAuthRefreshToken.client_id == client_id,
                OAuthRefreshToken.user_id == user_id,
                OAuthRefreshToken.revoked_at.is_(None),
            )
            .all()
        )
        for row in rows:
            row.revoked_at = datetime.now(timezone.utc)
        self.db.flush()
        return len(rows)


def _aware(value: datetime | None) -> datetime | None:
    """Postgres hands back aware datetimes, the SQLite test engine naive ones."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
