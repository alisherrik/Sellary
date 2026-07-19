"""initData HMAC verification against a known bot token + computed hash."""
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest

from services.telegram_auth_service import (
    TelegramAuthError,
    parse_and_verify_init_data,
)

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _sign(fields: dict, bot_token: str = BOT_TOKEN) -> str:
    """Build a valid init_data query string signed like Telegram does."""
    data_check_string = "\n".join(
        f"{k}={fields[k]}" for k in sorted(fields)
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode(), hashlib.sha256
    ).digest()
    computed = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    return urlencode({**fields, "hash": computed})


def _fields(telegram_id=42, auth_date=1_700_000_000, username="shopper"):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": username},
        separators=(",", ":"),
    )
    return {"auth_date": str(auth_date), "query_id": "abc", "user": user}


def test_valid_init_data_parses_identity():
    init_data = _sign(_fields())
    result = parse_and_verify_init_data(
        init_data, bot_token=BOT_TOKEN, now=1_700_000_100
    )
    assert result.telegram_id == 42
    assert result.username == "shopper"
    assert result.first_name == "Ali"
    assert result.auth_date == 1_700_000_000


def test_forged_hash_rejected():
    fields = _fields()
    fields["hash"] = "deadbeef" * 8  # wrong signature
    init_data = urlencode(fields)
    with pytest.raises(TelegramAuthError, match="signature"):
        parse_and_verify_init_data(
            init_data, bot_token=BOT_TOKEN, now=1_700_000_100
        )


def test_tampered_payload_rejected():
    # Sign, then mutate the user id after signing → hash no longer matches.
    init_data = _sign(_fields(telegram_id=42))
    tampered = init_data.replace("%22id%22%3A42", "%22id%22%3A99")
    assert tampered != init_data
    with pytest.raises(TelegramAuthError, match="signature"):
        parse_and_verify_init_data(
            tampered, bot_token=BOT_TOKEN, now=1_700_000_100
        )


def test_stale_auth_date_rejected():
    init_data = _sign(_fields(auth_date=1_700_000_000))
    with pytest.raises(TelegramAuthError, match="expired"):
        parse_and_verify_init_data(
            init_data,
            bot_token=BOT_TOKEN,
            max_age_seconds=60,
            now=1_700_000_000 + 3600,
        )


def test_wrong_bot_token_rejected():
    init_data = _sign(_fields(), bot_token="999:OTHER")
    with pytest.raises(TelegramAuthError, match="signature"):
        parse_and_verify_init_data(
            init_data, bot_token=BOT_TOKEN, now=1_700_000_100
        )


def test_empty_bot_token_rejected():
    with pytest.raises(TelegramAuthError, match="not configured"):
        parse_and_verify_init_data("auth_date=1&hash=x", bot_token="")


def test_missing_hash_rejected():
    with pytest.raises(TelegramAuthError, match="malformed"):
        parse_and_verify_init_data(
            "auth_date=1&user=%7B%7D", bot_token=BOT_TOKEN
        )
