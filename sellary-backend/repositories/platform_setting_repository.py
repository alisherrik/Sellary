"""Raw get/upsert for the platform_settings table. No encryption here — the
service layer handles crypto and masking. Flushes, never commits (transaction
rollback isolation in tests)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.platform_setting import PlatformSetting


class PlatformSettingRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, key: str) -> PlatformSetting | None:
        return self.db.execute(
            select(PlatformSetting).where(PlatformSetting.key == key)
        ).scalar_one_or_none()

    def upsert(self, key: str, encrypted_value: str) -> PlatformSetting:
        existing = self.get(key)
        if existing is not None:
            existing.encrypted_value = encrypted_value
            self.db.flush()
            return existing
        row = PlatformSetting(key=key, encrypted_value=encrypted_value)
        self.db.add(row)
        self.db.flush()
        return row
