"""
Sale Return Service for handling refunds and returns.
"""
from decimal import Decimal

from sqlalchemy.orm import Session

from core.state_machine import StateTransitionError, can_return_sale
from models.sale import SaleStatus
from models.sale_return import SaleReturn, SaleReturnItem
from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from repositories.sale_repository import SaleRepository
from schemas.sale_return import (
    SaleReturnCreate,
    SaleReturnItemResponse,
    SaleReturnResponse,
)
from services.tenant import resolve_company_id


class SaleReturnService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)

    def process_return(
        self,
        sale_id: int,
        return_data: SaleReturnCreate,
        user_id: int,
    ) -> SaleReturnResponse:
        sale = self.sale_repo.get_by_id_for_update(self.company_id, sale_id)
        if not sale:
            raise ValueError(f"Sale with id {sale_id} not found")

        if not can_return_sale(sale.status):
            raise StateTransitionError(
                entity_type="Sale",
                entity_id=sale_id,
                current_status=sale.status.value,
                target_status="return",
            )

        locked_items = self.sale_repo.get_sale_items_for_update(sale_id)
        sale_item_map = {item.id: item for item in locked_items}
        product_ids = []
        for return_item in return_data.items:
            sale_item = sale_item_map.get(return_item.sale_item_id)
            if not sale_item:
                raise ValueError(
                    f"Sale item with id {return_item.sale_item_id} not found in sale"
                )

            if return_item.quantity > sale_item.returnable_quantity:
                raise ValueError(
                    f"Cannot return {return_item.quantity} items. "
                    f"Only {sale_item.returnable_quantity} available for return "
                    f"(sold: {sale_item.quantity}, already returned: {sale_item.quantity_returned})"
                )

            if sale_item.product_id not in product_ids:
                product_ids.append(sale_item.product_id)

        product_ids.sort()
        locked_products = self.product_repo.get_multiple_for_update(
            self.company_id,
            product_ids,
        )
        product_map = {product.id: product for product in locked_products}

        total_refund = Decimal("0.00")
        return_items = []

        for return_item in return_data.items:
            sale_item = sale_item_map[return_item.sale_item_id]
            product = product_map[sale_item.product_id]

            if sale_item.quantity <= 0:
                raise ValueError(
                    f"Sale item {sale_item.id} has invalid quantity {sale_item.quantity}"
                )

            unit_refund = sale_item.total / sale_item.quantity
            item_refund = unit_refund * return_item.quantity
            total_refund += item_refund

            return_item_record = SaleReturnItem(
                sale_item_id=sale_item.id,
                quantity_returned=return_item.quantity,
                refund_amount=item_refund,
            )
            return_items.append(return_item_record)
            sale_item.quantity_returned += return_item.quantity

            previous_quantity = product.stock_quantity
            new_quantity = previous_quantity + return_item.quantity
            product.stock_quantity = new_quantity

            self.inventory_repo.create_log(
                company_id=self.company_id,
                product_id=product.id,
                user_id=user_id,
                quantity_change=return_item.quantity,
                previous_quantity=previous_quantity,
                new_quantity=new_quantity,
                reason=f"Return from Sale #{sale_id}",
                reference_type="sale_return",
                reference_id=None,
            )

        sale_return = SaleReturn(
            company_id=self.company_id,
            sale_id=sale_id,
            user_id=user_id,
            total_refund_amount=total_refund,
            refund_method=return_data.refund_method,
            notes=return_data.notes,
        )
        sale_return.items = return_items
        self.db.add(sale_return)
        self.db.flush()

        all_fully_returned = all(
            item.quantity_returned >= item.quantity
            for item in locked_items
        )
        sale.status = (
            SaleStatus.RETURNED
            if all_fully_returned
            else SaleStatus.PARTIALLY_RETURNED
        )
        self.db.flush()
        return self._to_response(sale_return)

    def get_returns_for_sale(self, sale_id: int) -> list[SaleReturnResponse]:
        returns = self.db.query(SaleReturn).filter(
            SaleReturn.company_id == self.company_id,
            SaleReturn.sale_id == sale_id,
        ).all()
        return [self._to_response(sale_return) for sale_return in returns]

    def _to_response(self, sale_return: SaleReturn) -> SaleReturnResponse:
        return SaleReturnResponse(
            id=sale_return.id,
            sale_id=sale_return.sale_id,
            user_id=sale_return.user_id,
            user_name=sale_return.user.full_name or sale_return.user.username,
            total_refund_amount=sale_return.total_refund_amount,
            refund_method=sale_return.refund_method,
            notes=sale_return.notes,
            created_at=sale_return.created_at,
            items=[
                SaleReturnItemResponse(
                    id=item.id,
                    sale_item_id=item.sale_item_id,
                    product_name=item.sale_item.product.name,
                    quantity_returned=item.quantity_returned,
                    refund_amount=item.refund_amount,
                )
                for item in sale_return.items
            ],
        )
