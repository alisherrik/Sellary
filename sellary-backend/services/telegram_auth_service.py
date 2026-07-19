"""Verify Telegram Web App ``initData`` per the official algorithm.

The Mini App sends ``initData`` (a URL-encoded query string) on every request.
We rebuild the data-check-string (all fields except ``hash``, sorted, joined by
newlines), derive ``secret_key = HMAC_SHA256("WebAppData", bot_token)``, and
compare ``HMAC_SHA256(secret_key, data_check_string)`` against the supplied
``hash`` with a constant-time compare. A stale ``auth_date`` is rejected so a
leaked initData string cannot be replayed indefinitely.

Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class TelegramAuthError(ValueError):
    """Raised when initData is missing, malformed, forged, or expired."""


@dataclass(frozen=True)
class TelegramInitData:
    telegram_id: int
    first_name: str | None
    username: str | None
    auth_date: int
    raw_user: dict


def parse_and_verify_init_data(
    init_data: str,
    *,
    bot_token: str,
    max_age_seconds: int | None = None,
    now: int | None = None,
) -> TelegramInitData:
    if not bot_token:
        raise TelegramAuthError("init data not configured")
    if not init_data:
        raise TelegramAuthError("malformed init data")

    # keep_blank_values so an empty field still contributes to the check string.
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash or "auth_date" not in pairs or "user" not in pairs:
        raise TelegramAuthError("malformed init data")

    data_check_string = "\n".join(
        f"{key}={pairs[key]}" for key in sorted(pairs)
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode(), hashlib.sha256
    ).digest()
    computed = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(computed, received_hash):
        raise TelegramAuthError("invalid init data signature")

    try:
        auth_date = int(pairs["auth_date"])
        user = json.loads(pairs["user"])
        telegram_id = int(user["id"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise TelegramAuthError("malformed init data") from exc

    if max_age_seconds is not None:
        current = now if now is not None else int(time.time())
        if current - auth_date > max_age_seconds:
            raise TelegramAuthError("init data expired")

    return TelegramInitData(
        telegram_id=telegram_id,
        first_name=user.get("first_name"),
        username=user.get("username"),
        auth_date=auth_date,
        raw_user=user,
    )
