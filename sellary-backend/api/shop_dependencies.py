from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.telegram_user import TelegramUser
from repositories.telegram_user_repository import TelegramUserRepository
from services.platform_settings_service import PlatformSettingsService
from services.telegram_auth_service import (
    TelegramAuthError,
    parse_and_verify_init_data,
)


def get_telegram_shopper(
    x_telegram_init_data: str = Header(..., alias="X-Telegram-Init-Data"),
    db: Session = Depends(get_db),
) -> TelegramUser:
    """Verify the Mini App initData header and yield the shopper identity.

    401 on missing/forged/expired data; 503 when the bot token is unconfigured
    (deployment misconfiguration, not the caller's fault).
    """
    try:
        identity = parse_and_verify_init_data(
            x_telegram_init_data,
            bot_token=PlatformSettingsService(db).resolve("telegram_bot_token"),
            max_age_seconds=settings.TELEGRAM_AUTH_MAX_AGE_SECONDS,
        )
    except TelegramAuthError as exc:
        detail = str(exc)
        if "not configured" in detail:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=detail
        )

    return TelegramUserRepository(db).get_or_create(
        identity.telegram_id,
        first_name=identity.first_name,
        username=identity.username,
    )
