"""Platform-global settings with DB-over-env resolution and masking.

resolve(key) is the single source of truth used by every call site: it returns
the decrypted DB value when a non-empty one is stored, else the env fallback
(settings.<ENV_NAME>). Storing writes a Fernet-encrypted token; plaintext never
leaves this service except through resolve().
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from core.config import settings as default_settings
from core.crypto import SecretDecryptError, decrypt_secret, encrypt_secret
from repositories.platform_setting_repository import PlatformSettingRepository


class PlatformSettingsService:
    KEYS: dict[str, str] = {
        "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
        "telegram_webhook_secret": "TELEGRAM_WEBHOOK_SECRET",
        "cloudinary_url": "CLOUDINARY_URL",
    }

    def __init__(self, db: Session, *, settings=default_settings):
        self.db = db
        self.settings = settings
        self.repo = PlatformSettingRepository(db)

    def _stored_plaintext(self, key: str) -> str | None:
        row = self.repo.get(key)
        if row is None:
            return None
        try:
            value = decrypt_secret(
                row.encrypted_value, secret_key=self.settings.SECRET_KEY
            )
        except SecretDecryptError:
            # SECRET_KEY was rotated (or row tampered): treat as unset so the
            # env fallback still works instead of crashing every request.
            return None
        return value or None

    def _env_value(self, key: str) -> str:
        return getattr(self.settings, self.KEYS[key], "") or ""

    def resolve(self, key: str) -> str:
        stored = self._stored_plaintext(key)
        if stored:
            return stored
        return self._env_value(key)

    def set(self, key: str, plaintext: str) -> None:
        if key not in self.KEYS:
            raise ValueError(f"unknown platform setting: {key}")
        token = encrypt_secret(plaintext, secret_key=self.settings.SECRET_KEY)
        self.repo.upsert(key, token)

    @staticmethod
    def _mask(value: str) -> str:
        if not value:
            return ""
        return "••••" + value[-4:] if len(value) >= 4 else "••••"

    def get_masked(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for key in self.KEYS:
            stored = self._stored_plaintext(key)
            if stored:
                resolved, source = stored, "db"
            else:
                env = self._env_value(key)
                resolved, source = env, ("env" if env else "unset")
            out[key] = {
                "is_set": bool(resolved),
                "masked": self._mask(resolved),
                "source": source,
            }
        return out

    def update_from_payload(self, updates: dict[str, str | None]) -> None:
        for key, raw in updates.items():
            if key not in self.KEYS:
                continue
            if raw is None:
                continue
            trimmed = raw.strip()
            if not trimmed:
                continue  # blank preserves existing
            self.set(key, trimmed)
