"""Owner-panel platform settings schemas (F7).

GET returns MASKED views only — plaintext is never serialized. PUT accepts
plaintext; a blank/omitted field preserves the stored value (see the service's
update_from_payload).
"""
from pydantic import BaseModel


class PlatformSettingView(BaseModel):
    is_set: bool
    masked: str
    source: str


class PlatformSettingsResponse(BaseModel):
    telegram_bot_token: PlatformSettingView
    telegram_webhook_secret: PlatformSettingView
    cloudinary_url: PlatformSettingView


class PlatformSettingsUpdate(BaseModel):
    telegram_bot_token: str | None = None
    telegram_webhook_secret: str | None = None
    cloudinary_url: str | None = None
