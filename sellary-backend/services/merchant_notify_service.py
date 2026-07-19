"""Merchant new-order notifications (F6).

Two jobs:
  * link_from_start_payload — verify the signed company-ref from the bot's
    /start deep-link and upsert a merchant_notify_links row.
  * notify_new_order — best-effort push to every linked chat. NEVER raises:
    a Bot API / network failure must not affect order placement.
  * build_notify_payload — gather order + chat_ids + message text from the DB
    while the request session is still open; returns plain data for a DB-free
    deferred background send (fixes the closed-session bug in production).
"""
from __future__ import annotations
import logging
from sqlalchemy.orm import Session

from core.config import settings
from models.order import Order
from repositories.merchant_notify_repository import MerchantNotifyRepository
from services.merchant_link_token import verify_company_ref
from services.telegram_bot_client import TelegramBotClient

logger = logging.getLogger(__name__)

_FULFILLMENT_RU = {"delivery": "доставка", "pickup": "самовывоз"}


class MerchantNotifyService:
    def __init__(self, db: Session, *, bot_client: TelegramBotClient | None = None):
        self.db = db
        self.repo = MerchantNotifyRepository(db)
        self._bot = bot_client or TelegramBotClient(
            bot_token=settings.TELEGRAM_BOT_TOKEN,
            base_url=settings.TELEGRAM_API_BASE_URL,
        )

    def link_from_start_payload(self, payload: str, telegram_chat_id: str) -> bool:
        company_id = verify_company_ref(payload, secret=settings.SECRET_KEY)
        if company_id is None:
            return False
        self.repo.upsert(company_id, telegram_chat_id)
        return True

    @staticmethod
    def format_order_message(order) -> str:
        n_items = len(order.items)
        fulfil = _FULFILLMENT_RU.get(str(order.fulfillment_type), str(order.fulfillment_type))
        return (
            f"\U0001f6d2 Новый заказ #{order.order_number}, "
            f"{n_items} товаров, {order.total_amount}, {fulfil}, "
            f"{order.contact_name} {order.contact_phone}"
        )

    def build_notify_payload(self, order_id: int):
        """Gather everything needed for a notification while the session is open.

        Returns ``(company_id, chat_ids, message)`` if there are linked chats,
        or ``None`` if no chats are linked (nothing to send).  All DB access
        happens here — the caller schedules a DB-free background send.

        Any exception propagates to the caller (the route) which swallows it
        best-effort, so order placement is never affected.
        """
        order = self.db.get(Order, order_id)
        if order is None:
            return None
        chat_ids = self.repo.list_chat_ids_for_company(order.company_id)
        if not chat_ids:
            return None
        message = self.format_order_message(order)
        return (order.company_id, chat_ids, message)

    def notify_new_order(self, order) -> None:
        try:
            chat_ids = self.repo.list_chat_ids_for_company(order.company_id)
            if not chat_ids:
                return
            text = self.format_order_message(order)
            for chat_id in chat_ids:
                try:
                    self._bot.send_message(chat_id, text)
                except Exception:
                    logger.warning(
                        "merchant notify send failed company=%s chat=%s order=%s",
                        order.company_id,
                        chat_id,
                        getattr(order, "order_number", "?"),
                        exc_info=True,
                    )
        except Exception:  # defense in depth — lookup/format must not bubble either
            logger.exception(
                "merchant notify failed for order company=%s",
                getattr(order, "company_id", "?"),
            )
