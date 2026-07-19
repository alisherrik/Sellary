"""Tests for POST /api/telegram/webhook (F6)."""
import pytest
from core.config import settings
from services.merchant_link_token import mint_company_ref
from repositories.merchant_notify_repository import MerchantNotifyRepository

SECRET = "webhook-secret-header-value"


@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", SECRET)


def _hdr(secret=SECRET):
    return {"X-Telegram-Bot-Api-Secret-Token": secret}


def test_start_payload_links_chat(client, db_session, default_company):
    payload = mint_company_ref(default_company.id, secret=settings.SECRET_KEY)
    body = {"update_id": 1, "message": {"chat": {"id": 55501}, "text": f"/start {payload}"}}
    resp = client.post("/api/telegram/webhook", json=body, headers=_hdr())
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == ["55501"]


def test_wrong_secret_rejected(client, default_company):
    body = {"update_id": 1, "message": {"chat": {"id": 1}, "text": "/start x"}}
    resp = client.post("/api/telegram/webhook", json=body, headers=_hdr("nope"))
    assert resp.status_code == 403


def test_missing_secret_rejected(client):
    resp = client.post("/api/telegram/webhook", json={"update_id": 1})
    assert resp.status_code == 403


def test_unconfigured_secret_fails_closed(client, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "")
    resp = client.post(
        "/api/telegram/webhook",
        json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": ""},
    )
    assert resp.status_code == 403


def test_irrelevant_update_is_noop_200(client, db_session, default_company):
    # A plain text message (no /start) — accepted, nothing linked.
    body = {"update_id": 2, "message": {"chat": {"id": 999}, "text": "hello bot"}}
    resp = client.post("/api/telegram/webhook", json=body, headers=_hdr())
    assert resp.status_code == 200
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == []


def test_start_without_payload_is_noop_200(client):
    body = {"update_id": 3, "message": {"chat": {"id": 999}, "text": "/start"}}
    assert client.post("/api/telegram/webhook", json=body, headers=_hdr()).status_code == 200


def test_empty_update_is_noop_200(client):
    assert client.post("/api/telegram/webhook", json={"update_id": 4}, headers=_hdr()).status_code == 200
