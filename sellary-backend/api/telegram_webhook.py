"""Telegram bot webhook (F6). Verifies the secret-token header, then handles the
merchant linking command `/start <company-ref>`. All other updates are a
graceful 200 no-op. The webhook commits its own link write."""
import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from schemas.telegram import TelegramUpdate
from services.merchant_notify_service import MerchantNotifyService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/telegram", tags=["telegram-webhook"])


def _verify_secret(secret_header: str | None) -> None:
    configured = settings.TELEGRAM_WEBHOOK_SECRET
    # Fail-closed: no configured secret → reject everything.
    if not configured or not secret_header or not hmac.compare_digest(secret_header, configured):
        raise HTTPException(status_code=403, detail="forbidden")


@router.post("/webhook")
def telegram_webhook(
    update: TelegramUpdate,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _verify_secret(x_telegram_bot_api_secret_token)

    msg = update.message
    text = (msg.text if msg else None) or ""
    if msg and msg.chat and text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) == 2 and parts[1].strip():
            payload = parts[1].strip()
            linked = MerchantNotifyService(db).link_from_start_payload(payload, str(msg.chat.id))
            if linked:
                db.commit()
    # Everything else (and failed/absent payloads): graceful no-op.
    return {"ok": True}
