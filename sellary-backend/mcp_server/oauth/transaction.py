"""The pending-authorization transaction.

An authorization request arrives before we know anything about the human. It
has to survive three page loads — login, company choice, consent — and then be
turned into a code. That state is signed into the `txn` parameter itself rather
than stored: it expires in fifteen minutes, carries no authority on its own,
and a fourth table for something that short-lived is not worth a migration.

Each step re-signs the transaction with what it learned, so the token grows:
the authorization parameters, then `user_id`, then `company_id`. A tampered or
expired token simply fails to decode and the flow restarts.
"""

from datetime import timedelta
from typing import Any

import jwt
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull

from core.config import settings

TXN_TOKEN_TYPE = "mcp_authorize_txn"
TXN_TTL_MINUTES = 15
MAX_LOGIN_ATTEMPTS = 5


class TransactionError(Exception):
    """The transaction is missing, expired, tampered with, or burnt out."""


def encode_txn(data: dict[str, Any]) -> str:
    from datetime import datetime, timezone

    payload = dict(data)
    payload["token_type"] = TXN_TOKEN_TYPE
    payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=TXN_TTL_MINUTES)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_txn(token: str | None) -> dict[str, Any]:
    if not token:
        raise TransactionError("Сессия авторизации не найдена.")
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except jwt.ExpiredSignatureError:
        raise TransactionError("Время авторизации истекло. Начните подключение заново.")
    except jwt.PyJWTError:
        raise TransactionError("Ссылка авторизации повреждена. Начните заново.")
    if payload.get("token_type") != TXN_TOKEN_TYPE:
        raise TransactionError("Неверная ссылка авторизации.")
    return payload


def authorize_url(
    client: OAuthClientInformationFull, params: AuthorizationParams
) -> str:
    """Where the browser goes after `/authorize`: our own login page."""
    txn = encode_txn(
        {
            "client_id": client.client_id,
            "client_name": client.client_name or client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "code_challenge": params.code_challenge,
            "scopes": list(params.scopes or []),
            "state": params.state,
            "resource": params.resource,
            "attempts": 0,
        }
    )
    root = settings.MCP_PUBLIC_BASE_URL.rstrip("/")
    return f"{root}/mcp/oauth/login?txn={txn}"


def with_values(payload: dict[str, Any], **updates: Any) -> str:
    """Carry the transaction forward with what this step established."""
    data = {
        key: value
        for key, value in payload.items()
        if key not in {"exp", "token_type"}
    }
    data.update(updates)
    return encode_txn(data)


def register_failed_attempt(payload: dict[str, Any]) -> str:
    """Count a bad password. Past the limit the transaction is unusable.

    Without this the authorize endpoint would be an unauthenticated password
    oracle that anyone can drive by starting a fresh OAuth flow.
    """
    attempts = int(payload.get("attempts", 0)) + 1
    if attempts >= MAX_LOGIN_ATTEMPTS:
        raise TransactionError(
            "Слишком много неудачных попыток входа. Начните подключение заново."
        )
    return with_values(payload, attempts=attempts)
