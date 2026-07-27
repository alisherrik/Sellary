"""OAuth 2.1 storage for the MCP connector.

Sellary is its own authorization server for MCP clients: the users, the company
memberships and the module grants that decide what a token may do all already
live in this database, so delegating to an external provider would only mean
mirroring them.

Three tables, three lifetimes. A client is registered once and kept. An
authorization code lives a minute and is destroyed the moment it is used. A
refresh token lives two months and is rotated on every use.

Refresh tokens are stored as SHA-256 digests — they are high-entropy random
strings rather than passwords, so a slow KDF would buy nothing the entropy does
not already provide, and they are only ever compared against a value the client
presents.

Client secrets cannot be hashed: the OAuth token endpoint compares the
presented secret against the stored one, so the stored one has to be
recoverable. They are encrypted at rest instead, with a key derived from
`SECRET_KEY`, so a database dump alone does not yield them.
"""

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.sql import func

from core.database import Base


class OAuthClient(Base):
    """An MCP client registered through RFC 7591 dynamic registration.

    Not tenant-scoped: claude.ai registers once and is then used by whoever
    logs in. The company is decided during the authorization flow and lives on
    the grant, never on the client.
    """

    __tablename__ = "oauth_clients"

    client_id = Column(String(64), primary_key=True)
    # Fernet ciphertext, or NULL for a public (PKCE-only) client.
    client_secret_enc = Column(String(400), nullable=True)
    client_name = Column(String(200), nullable=True)
    redirect_uris = Column(JSON, nullable=False, default=list)
    grant_types = Column(JSON, nullable=False, default=list)
    response_types = Column(JSON, nullable=False, default=list)
    scope = Column(String(200), nullable=True)
    token_endpoint_auth_method = Column(String(40), nullable=False, default="none")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OAuthAuthCode(Base):
    """A single-use authorization code, held for sixty seconds.

    Stored in the clear: it is destroyed on first use inside the same
    transaction that reads it, and hashing something with that lifetime would
    protect nothing a database dump could not already reach.
    """

    __tablename__ = "oauth_auth_codes"

    code = Column(String(64), primary_key=True)
    client_id = Column(String(64), nullable=False)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    company_id = Column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    redirect_uri = Column(String(500), nullable=False)
    redirect_uri_provided_explicitly = Column(Integer, nullable=False, default=1)
    code_challenge = Column(String(200), nullable=False)
    scopes = Column(JSON, nullable=False, default=list)
    resource = Column(String(500), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_oauth_auth_codes_expires_at", "expires_at"),)


class OAuthRefreshToken(Base):
    """A rotating refresh token: consumed on use, reissued alongside the pair."""

    __tablename__ = "oauth_refresh_tokens"

    token_hash = Column(String(64), primary_key=True)
    client_id = Column(String(64), nullable=False)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    company_id = Column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    scopes = Column(JSON, nullable=False, default=list)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_oauth_refresh_tokens_user_id", "user_id"),
        Index("ix_oauth_refresh_tokens_expires_at", "expires_at"),
    )
