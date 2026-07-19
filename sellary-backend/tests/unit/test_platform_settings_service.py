import pytest

from core.config import settings
from services.platform_settings_service import PlatformSettingsService


def test_resolve_falls_back_to_env_when_unset(db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "env-token")
    svc = PlatformSettingsService(db_session, settings=settings)
    assert svc.resolve("telegram_bot_token") == "env-token"


def test_db_value_overrides_env(db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "env-token")
    svc = PlatformSettingsService(db_session, settings=settings)
    svc.set("telegram_bot_token", "db-token")
    db_session.flush()
    assert svc.resolve("telegram_bot_token") == "db-token"


def test_set_stores_ciphertext_not_plaintext(db_session):
    from repositories.platform_setting_repository import PlatformSettingRepository
    svc = PlatformSettingsService(db_session, settings=settings)
    svc.set("cloudinary_url", "cloudinary://k:s@cloud")
    row = PlatformSettingRepository(db_session).get("cloudinary_url")
    assert row is not None
    assert "cloudinary://" not in row.encrypted_value  # encrypted


def test_get_masked_never_returns_plaintext(db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
    svc = PlatformSettingsService(db_session, settings=settings)
    svc.set("telegram_bot_token", "1234567890SECRET")
    masked = svc.get_masked()
    row = masked["telegram_bot_token"]
    assert row["is_set"] is True
    assert row["source"] == "db"
    assert row["masked"] == "••••CRET"
    assert "SECRET" not in row["masked"]


def test_get_masked_reports_env_source(db_session, monkeypatch):
    monkeypatch.setattr(settings, "CLOUDINARY_URL", "cloudinary://k:s@abcd")
    svc = PlatformSettingsService(db_session, settings=settings)
    row = svc.get_masked()["cloudinary_url"]
    assert row["is_set"] is True
    assert row["source"] == "env"
    assert row["masked"] == "••••abcd"


def test_get_masked_reports_unset(db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "")
    svc = PlatformSettingsService(db_session, settings=settings)
    row = svc.get_masked()["telegram_webhook_secret"]
    assert row == {"is_set": False, "masked": "", "source": "unset"}


def test_update_from_payload_blank_preserves(db_session):
    svc = PlatformSettingsService(db_session, settings=settings)
    svc.set("telegram_bot_token", "original")
    db_session.flush()
    svc.update_from_payload(
        {"telegram_bot_token": "", "telegram_webhook_secret": None, "cloudinary_url": "  "}
    )
    db_session.flush()
    assert svc.resolve("telegram_bot_token") == "original"


def test_update_from_payload_replaces_nonblank(db_session):
    svc = PlatformSettingsService(db_session, settings=settings)
    svc.set("telegram_bot_token", "original")
    db_session.flush()
    svc.update_from_payload({"telegram_bot_token": "  replaced  "})
    db_session.flush()
    assert svc.resolve("telegram_bot_token") == "replaced"  # trimmed
