from typing import List, Optional

from sqlalchemy.orm import Session

from models.cashier_device import CashierDevice


class CashierDeviceRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_device_id(self, device_id: str) -> Optional[CashierDevice]:
        return (
            self.db.query(CashierDevice)
            .filter(CashierDevice.device_id == device_id)
            .first()
        )

    def get_active_by_company(self, company_id: int) -> List[CashierDevice]:
        return (
            self.db.query(CashierDevice)
            .filter(
                CashierDevice.company_id == company_id,
                CashierDevice.is_active == True,  # noqa: E712
            )
            .all()
        )

    def list_by_company(self, company_id: int) -> List[CashierDevice]:
        return (
            self.db.query(CashierDevice)
            .filter(CashierDevice.company_id == company_id)
            .order_by(CashierDevice.created_at.desc())
            .all()
        )

    def add(self, device: CashierDevice) -> CashierDevice:
        self.db.add(device)
        self.db.flush()
        return device
