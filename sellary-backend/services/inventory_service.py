from typing import List, Tuple

from sqlalchemy.orm import Session

from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from schemas.inventory_log import InventoryAdjustment, InventoryLog
from services.inventory_ledger_service import InventoryLedgerService
from services.tenant import resolve_company_id


class InventoryService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.inventory_repo = InventoryRepository(db)
        self.product_repo = ProductRepository(db)
        self.ledger = InventoryLedgerService(db, self.company_id)

    def adjust_stock(self, adjustment: InventoryAdjustment, user_id: int) -> dict:
        product = self.product_repo.get_by_id_for_update(
            self.company_id, adjustment.product_id
        )
        if not product:
            raise ValueError(f"Product with id {adjustment.product_id} not found")

        if adjustment.quantity_change > 0:
            # A positive adjustment adds a new FIFO layer at the current average
            # cost so the average cost (and historical layer costs) are preserved.
            product = self.ledger.add_layer(
                product=product,
                quantity=adjustment.quantity_change,
                unit_cost=product.cost_price,
                source_type="manual_adjustment",
                source_id=None,
                user_id=user_id,
                reason=adjustment.reason,
                reference_type="manual_adjust",
            )
        else:
            # A negative adjustment consumes FIFO layers. consume_fifo writes the
            # negative inventory log itself, so we do not pre-create a log here.
            self.ledger.consume_fifo(
                product=product,
                quantity=-adjustment.quantity_change,
                consumer_type="manual_adjustment",
                consumer_id=product.id,
                sale_item_id=None,
                user_id=user_id,
                reason=adjustment.reason,
                reference_type="manual_adjust",
                reference_id=None,
            )

        return {
            "product_id": product.id,
            "product_name": product.name,
            "new_quantity": product.stock_quantity,
        }

    def get_logs(
        self,
        skip: int = 0,
        limit: int = 50,
        product_id: int = None,
    ) -> Tuple[List[InventoryLog], int]:
        logs, total = self.inventory_repo.get_logs(
            self.company_id,
            skip=skip,
            limit=limit,
            product_id=product_id,
        )
        return [self._log_to_response(log) for log in logs], total

    def get_inventory_value(self) -> dict:
        value = self.inventory_repo.get_inventory_value(self.company_id)
        products = self.product_repo.get_all(self.company_id, active_only=True)[0]
        total_items = sum(product.stock_quantity for product in products)

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
            value_change=log.value_change,
            previous_quantity=log.previous_quantity,
            new_quantity=log.new_quantity,
            reason=log.reason,
            reference_type=log.reference_type,
            reference_id=log.reference_id,
            created_at=log.created_at,
        )
