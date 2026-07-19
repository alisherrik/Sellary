"""Prove the resolver rewiring: DB value overrides env, env fallback still works.

Driven end-to-end through the webhook secret path (the easiest call site to
exercise). The test `client` and `db_session` fixtures share the same session
(get_db is overridden), so setting a DB value via the service is visible to the
request.
"""
from core.config import settings
from services.platform_settings_service import PlatformSettingsService


def test_webhook_uses_env_secret_when_no_db_value(client, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "env-secret")
    ok = client.post(
        "/api/telegram/webhook",
        json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": "env-secret"},
    )
    assert ok.status_code == 200
    bad = client.post(
        "/api/telegram/webhook",
        json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
    )
    assert bad.status_code == 403


def test_webhook_db_secret_overrides_env(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "env-secret")
    PlatformSettingsService(db_session).set("telegram_webhook_secret", "db-secret")
    db_session.flush()
    # env value now rejected, db value accepted
    assert client.post(
        "/api/telegram/webhook",
        json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": "env-secret"},
    ).status_code == 403
    assert client.post(
        "/api/telegram/webhook",
        json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": "db-secret"},
    ).status_code == 200
