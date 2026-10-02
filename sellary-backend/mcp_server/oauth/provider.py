"""Sellary as an OAuth 2.1 authorization server for MCP clients.

FastMCP's `OAuthProvider` supplies the protocol surface — metadata documents,
dynamic registration, PKCE enforcement, the token endpoint, the 401 challenge.
What it cannot supply is the part that is specific to this product: who the
human is, and which of their companies this token speaks for.

That is why `authorize()` does not answer directly. It parks the request under
a signed transaction and sends the browser to our own three-step flow
(login -> company -> consent), which finally mints the code.

MCP access tokens have their own type and resource audience. Live membership
and module grants still decide access, but the delegated token cannot enter
the ordinary REST API or exchange itself for a web session.
"""

import logging
from datetime import datetime, timedelta

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    AuthorizeError,
    TokenError,
)
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

from core.config import settings
from core.security import (
    ACCESS_TOKEN_TYPE,
    MCP_ACCESS_TOKEN_TYPE,
    create_access_token,
    decode_access_token,
)
from fastmcp.exceptions import ToolError
from fastmcp.server.auth import OAuthProvider
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from mcp_server import SCOPES
from mcp_server.oauth import store
from mcp_server.oauth.transaction import authorize_url

logger = logging.getLogger(__name__)


class SellaryOAuthProvider(OAuthProvider):
    """Authorization server and resource server in one.

    Both roles live here because the thing that decides what a token may do —
    the company membership and its module grants — is in this database. Sending
    users to an external identity provider would mean mirroring all of it.
    """

    def __init__(self, base_url: str, issuer_url: str | None = None):
        super().__init__(
            base_url=base_url,
            issuer_url=issuer_url,
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                valid_scopes=list(SCOPES),
                default_scopes=list(SCOPES),
            ),
            revocation_options=RevocationOptions(enabled=True),
            # No scope is required to reach the endpoint. Authorisation is
            # decided per tool against the company's module set and the
            # member's grants, which is finer than any scope could be.
            required_scopes=[],
        )

    def set_mcp_path(self, mcp_path: str | None) -> None:
        """Keep the resource identifier free of a trailing slash.

        The MCP app is mounted at `/mcp` and serves its endpoint at that
        mount's root, so FastMCP is told `path="/"` — which would otherwise
        produce the resource id `https://host/mcp/`. Clients are given
        `https://host/mcp`, and an identifier that differs by one character is
        an audience mismatch that surfaces only as a connector that will not
        authenticate.
        """
        super().set_mcp_path(None if mcp_path in (None, "", "/") else mcp_path)

    # ------------------------------------------------------------- clients

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        record = await run_in_threadpool(store.get_client, client_id)
        if record is None:
            return None
        return OAuthClientInformationFull(
            client_id=record.client_id,
            client_secret=record.client_secret,
            client_name=record.client_name,
            redirect_uris=[AnyUrl(uri) for uri in record.redirect_uris],
            grant_types=record.grant_types or ["authorization_code", "refresh_token"],
            response_types=record.response_types or ["code"],
            scope=record.scope,
            token_endpoint_auth_method=record.token_endpoint_auth_method,
        )

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        await run_in_threadpool(
            store.save_client,
            client_id=client_info.client_id,
            client_secret=client_info.client_secret,
            client_name=client_info.client_name,
            redirect_uris=[str(uri) for uri in client_info.redirect_uris],
            grant_types=list(client_info.grant_types or []),
            response_types=list(client_info.response_types or []),
            scope=client_info.scope,
            token_endpoint_auth_method=client_info.token_endpoint_auth_method or "none",
        )
        logger.info(
            "MCP client registered: %s (%s)",
            client_info.client_name,
            client_info.client_id,
        )

    # ------------------------------------------------------- authorize step

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Park the request and hand the browser to the human flow.

        Nothing is decided here. The code is only minted at the end of
        login -> company -> consent, by `mcp_server.oauth.routes`.
        """
        if params.resource and params.resource != self._resource_identifier:
            raise AuthorizeError("invalid_request", "Unsupported resource")
        return authorize_url(client, params)

    # -------------------------------------------------- authorization codes

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        grant = await run_in_threadpool(store.peek_auth_code, authorization_code)
        if grant is None or grant.client_id != client.client_id:
            return None
        return AuthorizationCode(
            code=authorization_code,
            scopes=grant.scopes,
            expires_at=grant.expires_at.timestamp() if grant.expires_at else 0.0,
            client_id=grant.client_id,
            code_challenge=grant.code_challenge or "",
            redirect_uri=AnyUrl(grant.redirect_uri or ""),
            redirect_uri_provided_explicitly=grant.redirect_uri_provided_explicitly,
            resource=grant.resource,
            subject=str(grant.user_id),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        return await run_in_threadpool(
            self._exchange_authorization_code, client, authorization_code
        )

    def _exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        # `take_` rather than `peek_`: the code is destroyed in the same
        # transaction it is read in, so a replayed code finds nothing.
        grant = store.take_auth_code(authorization_code.code)
        if grant is None or grant.client_id != client.client_id:
            raise TokenError("invalid_grant", "Authorization code is invalid or already used")
        if grant.resource and grant.resource != self._resource_identifier:
            raise TokenError("invalid_grant", "Unsupported resource")

        return self._issue_tokens(
            client_id=client.client_id,
            user_id=grant.user_id,
            company_id=grant.company_id,
            scopes=grant.scopes,
        )

    # -------------------------------------------------------- refresh flow

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        grant = await run_in_threadpool(store.peek_refresh_token, refresh_token)
        if grant is None or grant.client_id != client.client_id:
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=grant.client_id,
            scopes=grant.scopes,
            expires_at=int(grant.expires_at.timestamp()) if grant.expires_at else None,
            subject=str(grant.user_id),
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        return await run_in_threadpool(
            self._exchange_refresh_token, client, refresh_token, scopes
        )

    def _exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        def issue(db: Session, grant: store.GrantRecord | None) -> OAuthToken:
            if grant is None or grant.client_id != client.client_id:
                raise TokenError("invalid_grant", "Refresh token is invalid or expired")
            granted = scopes if scopes else grant.scopes
            if not set(granted).issubset(grant.scopes):
                raise TokenError("invalid_scope", "Refresh scope exceeds the original grant")
            return self._issue_tokens(
                client_id=client.client_id,
                user_id=grant.user_id,
                company_id=grant.company_id,
                scopes=granted,
                db=db,
                connected_at=grant.created_at,
            )

        return store.rotate_refresh_token(refresh_token.token, issue)

    # -------------------------------------------------------- access tokens

    async def load_access_token(self, token: str) -> AccessToken | None:
        payload = decode_access_token(
            token, audience=self._resource_identifier, allow_missing_audience=True
        )
        if payload is None:
            return None
        if payload.get("token_type") not in {ACCESS_TOKEN_TYPE, MCP_ACCESS_TOKEN_TYPE}:
            return None
        if payload.get("token_type") == MCP_ACCESS_TOKEN_TYPE and not payload.get("aud"):
            return None
        if payload.get("iss") is not None and payload["iss"] != str(self.issuer_url).rstrip("/"):
            return None
        # An ordinary web-session token must not open the MCP endpoint. Only a
        # token minted through this flow carries `mcp`.
        if payload.get("mcp") is not True:
            return None
        if payload.get("user_id") is None or payload.get("company_id") is None:
            return None

        return AccessToken(
            token=token,
            client_id=str(payload.get("mcp_client_id") or "sellary-mcp"),
            scopes=list(payload.get("scopes") or []),
            expires_at=payload.get("exp"),
            resource=str(self._resource_url) if self._resource_url else None,
            subject=str(payload.get("user_id")),
            claims=payload,
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        # Access tokens are stateless JWTs and expire on their own; only the
        # refresh token has a record to strike.
        if isinstance(token, RefreshToken):
            await run_in_threadpool(store.revoke_refresh_token, token.token)

    # -------------------------------------------------------------- helpers

    @property
    def _resource_identifier(self) -> str:
        return str(self._resource_url or self.base_url).rstrip("/")

    def _issue_tokens(
        self,
        *,
        client_id: str,
        user_id: int,
        company_id: int,
        scopes: list[str],
        db: Session | None = None,
        connected_at: datetime | None = None,
    ) -> OAuthToken:
        from services.auth_service import AuthService  # local: avoids import cycle
        from core.database import SessionLocal
        from mcp_server.context import resolve_caller

        owns_session = db is None
        db = db if db is not None else SessionLocal()
        try:
            try:
                auth = resolve_caller(db, user_id, company_id, scopes)
                session = AuthService(db).create_company_session(auth.user, company_id)
            except (ToolError, ValueError) as exc:
                raise TokenError("invalid_grant", str(exc)) from exc

            base_claims = decode_access_token(session.access_token) or {}
            claims = {
                key: value
                for key, value in base_claims.items()
                if key not in {"exp", "token_type"}
            }
            claims.update({
                "mcp": True,
                "scopes": scopes,
                "mcp_client_id": client_id,
                "aud": self._resource_identifier,
                "iss": str(self.issuer_url).rstrip("/"),
            })

            expires_in = settings.MCP_ACCESS_TOKEN_EXPIRE_MINUTES * 60
            access_token = create_access_token(
                data=claims,
                expires_delta=timedelta(seconds=expires_in),
                token_type=MCP_ACCESS_TOKEN_TYPE,
            )
            refresh_token = store.new_token()
            store.save_refresh_token(
                refresh_token,
                store.GrantRecord(
                    client_id=client_id,
                    user_id=user_id,
                    company_id=company_id,
                    scopes=scopes,
                    created_at=connected_at,
                ),
                db=db,
            )
            if owns_session:
                db.commit()
            return OAuthToken(
                access_token=access_token,
                token_type="Bearer",
                expires_in=expires_in,
                scope=" ".join(scopes),
                refresh_token=refresh_token,
            )
        finally:
            if owns_session:
                db.close()


def build_provider() -> SellaryOAuthProvider:
    """Operational endpoints live under the /mcp mount; discovery at the root."""
    root = settings.MCP_PUBLIC_BASE_URL.rstrip("/")
    return SellaryOAuthProvider(base_url=f"{root}/mcp", issuer_url=f"{root}/mcp")
