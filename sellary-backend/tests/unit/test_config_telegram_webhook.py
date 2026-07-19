from core.config import Settings


def test_telegram_webhook_settings_have_safe_defaults():
    s = Settings()
    assert s.TELEGRAM_WEBHOOK_SECRET == ""          # empty → webhook rejects all (fail-closed)
    assert s.TELEGRAM_API_BASE_URL == "https://api.telegram.org"


def test_telegram_webhook_secret_reads_from_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t-header-value")
    assert Settings().TELEGRAM_WEBHOOK_SECRET == "s3cr3t-header-value"
