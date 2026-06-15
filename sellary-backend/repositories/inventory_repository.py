from decimal import Decimal
from sqlalchemy.orm import Session, joinedload
from models.inventory_log import InventoryLog
from models.product import Product
from typing import Optional, List


class InventoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_logs(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        product_id: Optional[int] = None,
    ) -> tuple[List[InventoryLog], int]:
        query = self.db.query(InventoryLog).options(
            joinedload(InventoryLog.product), joinedload(InventoryLog.user)
        ).filter(InventoryLog.company_id == company_id)

        if product_id:
            query = query.filter(InventoryLog.product_id == product_id)

        query = query.order_by(InventoryLog.created_at.desc())

        total = query.count()
        logs = query.offset(skip).limit(limit).all()

        return logs, total

    def create_log(
        self,
        company_id: int,
        product_id: int,
        user_id: int,
        quantity_change: int,
        previous_quantity: int,
        new_quantity: int,
        reason: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[int] = None,
    ) -> InventoryLog:
        """
        Create inventory log entry.
        NOTE: Does NOT commit - caller must manage transaction.
        """
        log = InventoryLog(
            company_id=company_id,
            product_id=product_id,
            user_id=user_id,
            quantity_change=quantity_change,
            previous_quantity=previous_quantity,
            new_quantity=new_quantity,
            reason=reason,
            reference_type=reference_type,
            reference_id=reference_id,
        )
        self.db.add(log)
        # No commit here - let caller manage the transaction
        return log

    def get_inventory_value(self, company_id: int) -> Decimal:
        from sqlalchemy import func

        result = (
            self.db.query(func.sum(Product.inventory_value))
            .filter(
                Product.company_id == company_id,
                Product.is_active == True,
            )
            .scalar()
        )
        return result or Decimal("0.00")
