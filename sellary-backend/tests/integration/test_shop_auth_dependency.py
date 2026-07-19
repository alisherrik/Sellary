"""get_telegram_shopper verifies the header and get-or-creates the shopper."""
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.shop_dependencies import get_telegram_shopper
from core.config import settings
from core.database import get_db
from models.telegram_user import TelegramUser

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _sign(telegram_id=42, auth_date=1_700_000_000, bot_token=BOT_TOKEN):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": "shopper"},
        separators=(",", ":"),
    )
    fields = {"auth_date": str(auth_date), "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture
def shop_client(db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    # Disable staleness so a fixed old auth_date still validates.
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10**12)

    app = FastAPI()

    @app.get("/whoami")
    def whoami(shopper: TelegramUser = Depends(get_telegram_shopper)):
        return {"telegram_id": shopper.telegram_id, "id": shopper.id}

    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_valid_header_creates_shopper(shop_client, db_session):
    resp = shop_client.get(
        "/whoami", headers={"X-Telegram-Init-Data": _sign(telegram_id=42)}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["telegram_id"] == 42
    assert (
        db_session.query(TelegramUser).filter_by(telegram_id=42).count() == 1
    )


def test_missing_header_401(shop_client):
    resp = shop_client.get("/whoami")
    assert resp.status_code in (401, 422)  # FastAPI 422 for missing required header


def test_forged_header_401(shop_client):
    forged = _sign(telegram_id=42, bot_token="999:WRONG")
    resp = shop_client.get("/whoami", headers={"X-Telegram-Init-Data": forged})
    assert resp.status_code == 401, resp.text
