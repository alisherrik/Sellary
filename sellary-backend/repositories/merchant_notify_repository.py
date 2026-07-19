from sqlalchemy import select
from sqlalchemy.orm import Session
from models.merchant_notify_link import MerchantNotifyLink


class MerchantNotifyRepository:
    def __init__(self, db: Session):
        self.db = db

    def upsert(self, company_id: int, telegram_chat_id: str) -> MerchantNotifyLink:
        existing = self.db.execute(
            select(MerchantNotifyLink).where(
                MerchantNotifyLink.company_id == company_id,
                MerchantNotifyLink.telegram_chat_id == telegram_chat_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        link = MerchantNotifyLink(company_id=company_id, telegram_chat_id=telegram_chat_id)
        self.db.add(link)
        self.db.flush()
        return link

    def list_chat_ids_for_company(self, company_id: int) -> list[str]:
        rows = self.db.execute(
            select(MerchantNotifyLink.telegram_chat_id).where(
                MerchantNotifyLink.company_id == company_id
            )
        ).scalars().all()
        return list(rows)
