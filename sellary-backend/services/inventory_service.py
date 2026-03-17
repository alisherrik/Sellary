from typing import List, Tuple
from sqlalchemy.orm import Session
from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from schemas.inventory_log import InventoryAdjustment, InventoryLog


class InventoryService:
    def __init__(self, db: Session):
        self.db = db
        self.inventory_repo = InventoryRepository(db)
        self.product_repo = ProductRepository(db)

    def adjust_stock(
        self, adjustment: InventoryAdjustment, user_id: int
    ) -> dict:
        product = self.inventory_repo.adjust_stock(
            product_id=adjustment.product_id,
            user_id=user_id,
            quantity_change=adjustment.quantity_change,
            reason=adjustment.reason,
        )
        return {
            "product_id": product.id,
            "product_name": product.name,
            "new_quantity": product.stock_quantity,
        }

    def get_logs(
        self, skip: int = 0, limit: int = 50, product_id: int = None
    ) -> Tuple[List[InventoryLog], int]:
        logs, total = self.inventory_repo.get_logs(
            skip=skip, limit=limit, product_id=product_id
        )
        return [self._log_to_response(log) for log in logs], total

    def get_inventory_value(self) -> dict:
        from repositories.inventory_repository import InventoryRepository

        value = self.inventory_repo.get_inventory_value()
        products = self.product_repo.get_all(active_only=True)[0]
        total_items = sum(p.stock_quantity for p in products)

        return {
            "total_value": str(value),
            "total_products": len(products),
            "total_items": total_items,
        }

    def _log_to_response(self, log) -> InventoryLog:
        return InventoryLog(
            id=log.id,
            product_id=log.product_id,
            product_name=log.product.name,
            user_id=log.user_id,
            user_name=log.user.full_name or log.user.username,
            quantity_change=log.quantity_change,
            previous_quantity=log.previous_quantity,
            new_quantity=log.new_quantity,
            reason=log.reason,
            reference_type=log.reference_type,
            reference_id=log.reference_id,
            created_at=log.created_at,
        )
