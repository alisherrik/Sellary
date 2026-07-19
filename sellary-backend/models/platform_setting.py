"""Platform-global, Fernet-encrypted settings editable from the Owner panel.

Single shared values (Telegram bot token/webhook secret, Cloudinary URL) that
used to be env-only. Values are stored encrypted (see core/crypto.py); the
plaintext never touches this table. Not tenant-scoped — one row per key.
"""
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from core.database import Base


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(64), nullable=False, unique=True, index=True)
    encrypted_value = Column(Text, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
