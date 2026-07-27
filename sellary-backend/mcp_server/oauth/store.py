"""Database access for the OAuth authorization server.

Every function opens and closes its own session. The provider is driven from
async code while the ORM is synchronous, so these are deliberately small,
self-contained units of work rather than anything that holds a session open
across an await.

Two of them — `take_auth_code` and `take_refresh_token` — read and delete in
one transaction. That single-use property is the entire security value of an
authorization code, so it must not be split into a read followed by a separate
delete.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings
from core.database import SessionLocal
from models.oauth import OAuthAuthCode, OAuthClient, OAuthRefreshToken


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def _cipher() -> Fernet:
    """Fernet keyed from SECRET_KEY.

    Rotating SECRET_KEY invalidates stored client secrets, which is the same
    blast radius rotating it already has for every issued JWT — clients simply
    re-register.
    """
    digest = hashlib.sha256(f"mcp-oauth:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    return _cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        # Written under a different SECRET_KEY. Treat as an unusable client
        # rather than crashing the token endpoint; the client re-registers.
        return None


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _dialect(db) -> str:
    try:
        return db.get_bind().dialect.name
    except Exception:
        return ""


def _aware(value: datetime | None) -> datetime | None:
    """Postgres hands back aware datetimes, SQLite naive ones.

    Comparing the two raises, so tests on SQLite would fail on a code path that
    is fine in production — normalise instead of discovering it at runtime.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@dataclass
class ClientRecord:
    client_id: str
    client_secret: str | None
    client_name: str | None
    redirect_uris: list[str]
    grant_types: list[str]
    response_types: list[str]
    scope: str | None
    token_endpoint_auth_method: str


@dataclass
class GrantRecord:
    """What a code or refresh token stands for: a user, inside one company."""

    client_id: str
    user_id: int
    company_id: int
    scopes: list[str]
    redirect_uri: str | None = None
    redirect_uri_provided_explicitly: bool = True
    code_challenge: str | None = None
    resource: str | None = None
    expires_at: datetime | None = None


# ------------------------------------------------------------------ clients


def get_client(client_id: str) -> ClientRecord | None:
    db = SessionLocal()
    try:
        row = db.query(OAuthClient).filter(OAuthClient.client_id == client_id).first()
        if row is None:
            return None
        return ClientRecord(
            client_id=row.client_id,
            client_secret=decrypt_secret(row.client_secret_enc),
            client_name=row.client_name,
            redirect_uris=list(row.redirect_uris or []),
            grant_types=list(row.grant_types or []),
            response_types=list(row.response_types or []),
            scope=row.scope,
            token_endpoint_auth_method=row.token_endpoint_auth_method,
        )
    finally:
        db.close()


def save_client(
    *,
    client_id: str,
    client_secret: str | None,
    client_name: str | None,
    redirect_uris: list[str],
    grant_types: list[str],
    response_types: list[str],
    scope: str | None,
    token_endpoint_auth_method: str,
) -> None:
    db = SessionLocal()
    try:
        row = db.query(OAuthClient).filter(OAuthClient.client_id == client_id).first()
        if row is None:
            row = OAuthClient(client_id=client_id)
            db.add(row)
        row.client_secret_enc = encrypt_secret(client_secret) if client_secret else None
        row.client_name = client_name
        row.redirect_uris = redirect_uris
        row.grant_types = grant_types
        row.response_types = response_types
        row.scope = scope
        row.token_endpoint_auth_method = token_endpoint_auth_method
        db.commit()
    finally:
        db.close()


# ------------------------------------------------------- authorization codes


def save_auth_code(code: str, grant: GrantRecord, ttl_seconds: int = 60) -> None:
    db = SessionLocal()
    try:
        db.add(
            OAuthAuthCode(
                code=code,
                client_id=grant.client_id,
                user_id=grant.user_id,
                company_id=grant.company_id,
                redirect_uri=grant.redirect_uri or "",
                redirect_uri_provided_explicitly=(
                    1 if grant.redirect_uri_provided_explicitly else 0
                ),
                code_challenge=grant.code_challenge or "",
                scopes=grant.scopes,
                resource=grant.resource,
                expires_at=_utcnow() + timedelta(seconds=ttl_seconds),
            )
        )
        db.commit()
    finally:
        db.close()


def peek_auth_code(code: str) -> GrantRecord | None:
    """Read a code without consuming it — the provider loads before exchanging."""
    db = SessionLocal()
    try:
        row = db.query(OAuthAuthCode).filter(OAuthAuthCode.code == code).first()
        if row is None:
            return None
        expires_at = _aware(row.expires_at)
        if expires_at is not None and expires_at <= _utcnow():
            db.delete(row)
            db.commit()
            return None
        return GrantRecord(
            client_id=row.client_id,
            user_id=row.user_id,
            company_id=row.company_id,
            scopes=list(row.scopes or []),
            redirect_uri=row.redirect_uri,
            redirect_uri_provided_explicitly=bool(row.redirect_uri_provided_explicitly),
            code_challenge=row.code_challenge,
            resource=row.resource,
            expires_at=expires_at,
        )
    finally:
        db.close()


def take_auth_code(code: str) -> GrantRecord | None:
    """Read and destroy in one transaction. A code works exactly once."""
    db = SessionLocal()
    try:
        query = db.query(OAuthAuthCode).filter(OAuthAuthCode.code == code)
        # Lock the row so two simultaneous exchanges of the same code cannot
        # both read it before either deletes it. SQLite has no row locks and
        # needs none — the test engine is single-connection.
        if _dialect(db) == "postgresql":
            query = query.with_for_update()
        row = query.first()
        if row is None:
            return None
        grant = GrantRecord(
            client_id=row.client_id,
            user_id=row.user_id,
            company_id=row.company_id,
            scopes=list(row.scopes or []),
            redirect_uri=row.redirect_uri,
            redirect_uri_provided_explicitly=bool(row.redirect_uri_provided_explicitly),
            code_challenge=row.code_challenge,
            resource=row.resource,
            expires_at=_aware(row.expires_at),
        )
        db.delete(row)
        db.commit()
        if grant.expires_at is not None and grant.expires_at <= _utcnow():
            return None
        return grant
    finally:
        db.close()


# ----------------------------------------------------------- refresh tokens


def save_refresh_token(token: str, grant: GrantRecord) -> None:
    db = SessionLocal()
    try:
        db.add(
            OAuthRefreshToken(
                token_hash=hash_secret(token),
                client_id=grant.client_id,
                user_id=grant.user_id,
                company_id=grant.company_id,
                scopes=grant.scopes,
                expires_at=_utcnow()
                + timedelta(days=settings.MCP_REFRESH_TOKEN_EXPIRE_DAYS),
            )
        )
        db.commit()
    finally:
        db.close()


def peek_refresh_token(token: str) -> GrantRecord | None:
    db = SessionLocal()
    try:
        row = (
            db.query(OAuthRefreshToken)
            .filter(OAuthRefreshToken.token_hash == hash_secret(token))
            .first()
        )
        if row is None or row.revoked_at is not None:
            return None
        expires_at = _aware(row.expires_at)
        if expires_at is not None and expires_at <= _utcnow():
            return None
        return GrantRecord(
            client_id=row.client_id,
            user_id=row.user_id,
            company_id=row.company_id,
            scopes=list(row.scopes or []),
            expires_at=expires_at,
        )
    finally:
        db.close()


def take_refresh_token(token: str) -> GrantRecord | None:
    """Consume a refresh token. Rotation: the caller issues a fresh one."""
    db = SessionLocal()
    try:
        row = (
            db.query(OAuthRefreshToken)
            .filter(OAuthRefreshToken.token_hash == hash_secret(token))
            .first()
        )
        if row is None or row.revoked_at is not None:
            return None
        expires_at = _aware(row.expires_at)
        grant = GrantRecord(
            client_id=row.client_id,
            user_id=row.user_id,
            company_id=row.company_id,
            scopes=list(row.scopes or []),
            expires_at=expires_at,
        )
        db.delete(row)
        db.commit()
        if expires_at is not None and expires_at <= _utcnow():
            return None
        return grant
    finally:
        db.close()


def revoke_refresh_token(token: str) -> None:
    db = SessionLocal()
    try:
        row = (
            db.query(OAuthRefreshToken)
            .filter(OAuthRefreshToken.token_hash == hash_secret(token))
            .first()
        )
        if row is not None:
            row.revoked_at = _utcnow()
            db.commit()
    finally:
        db.close()


def purge_expired() -> dict[str, Any]:
    """Housekeeping for anything that outlived its window."""
    db = SessionLocal()
    try:
        now = _utcnow()
        codes = (
            db.query(OAuthAuthCode).filter(OAuthAuthCode.expires_at <= now).delete()
        )
        tokens = (
            db.query(OAuthRefreshToken)
            .filter(OAuthRefreshToken.expires_at <= now)
            .delete()
        )
        db.commit()
        return {"codes": codes, "refresh_tokens": tokens}
    finally:
        db.close()
