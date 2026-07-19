"""Signed opaque company reference carried in the bot's /start deep-link.

Format:  b64url(company_id_bytes) + "." + b64url(HMAC_SHA256(secret, company_id_bytes)[:16])
The signature prevents a stranger from linking their chat to someone else's shop.
Pure helper — no DB, no network. Reuses the codebase HMAC idiom (telegram_auth_service).
"""
from __future__ import annotations
import base64
import hashlib
import hmac

_SIG_BYTES = 16  # 128-bit tag → 22 b64url chars, well within Telegram's 64-char budget


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sig(company_bytes: bytes, secret: str) -> bytes:
    return hmac.new(secret.encode(), company_bytes, hashlib.sha256).digest()[:_SIG_BYTES]


_SEP = "--"  # double-dash separates body from sig; safe in [A-Za-z0-9_-] and not in b64url output


def mint_company_ref(company_id: int, *, secret: str) -> str:
    body = str(company_id).encode()
    return f"{_b64(body)}{_SEP}{_b64(_sig(body, secret))}"


def verify_company_ref(token: str, *, secret: str) -> int | None:
    if not token or _SEP not in token:
        return None
    idx = token.index(_SEP)
    body_b64, sig_b64 = token[:idx], token[idx + len(_SEP):]
    try:
        body = _unb64(body_b64)
        provided = _unb64(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(provided, _sig(body, secret)):
        return None
    try:
        return int(body.decode())
    except ValueError:
        return None
