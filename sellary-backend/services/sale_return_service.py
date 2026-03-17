"""
Sale Return Service for handling refunds and returns.
"""
from decimal import Decimal
from typing import Optional
from sqlalchemy.orm import Session
from repositories.sale_repository import SaleRepository
from repositories.product_repository import ProductRepository
from repositories.inventory_repository import InventoryRepository
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn, SaleReturnItem
from schemas.sale_return import SaleReturnCreate, SaleReturnResponse, SaleReturnItemResponse
from core.state_machine import can_return_sale, StateTransitionError


class SaleReturnService:
    def __init__(self, db: Session):
        self.db = db
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)

    def process_return(
        self, sale_id: int, return_data: SaleReturnCreate, user_id: int
    ) -> SaleReturnResponse:
        """
        Process a sale return with full transactional safety.
        
        Uses row-level locking (SELECT ... FOR UPDATE) on products to prevent
        race conditions during stock restoration.
        
        Args:
            sale_id: ID of the sale to return
            return_data: Return request data
            user_id: ID of the user processing the return
            
        Returns:
            SaleReturnResponse with the created return record
            
        Raises:
            ValueError: If validation fails
            StateTransitionError: If sale status doesn't allow returns
        """
        try:
            # Step 1: Fetch and validate sale
            sale = self.sale_repo.get_by_id(sale_id)
            if not sale:
                raise ValueError(f"Sale with id {sale_id} not found")
            
            # Step 2: Validate sale status allows returns
            if not can_return_sale(sale.status):
                raise StateTransitionError(
                    entity_type="Sale",
                    entity_id=sale_id,
                    current_status=sale.status.value,
                    target_status="return"
                )
            
            # Step 3: Build map of sale items
            sale_item_map = {item.id: item for item in sale.items}
            
            # Step 4: Validate return items and collect product IDs
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
                
                product_ids.append(sale_item.product_id)
            
            # Step 5: Lock all product rows for stock update
            locked_products = self.product_repo.get_multiple_for_update(product_ids)
            product_map = {p.id: p for p in locked_products}
            
            # Step 6: Create sale return record
            total_refund = Decimal("0.00")
            return_items = []
            
            for return_item in return_data.items:
                sale_item = sale_item_map[return_item.sale_item_id]
                product = product_map[sale_item.product_id]
                
                # Calculate refund amount (proportional to unit price + tax - discount)
                # Refund per item = (item_total / quantity) * return_quantity
                unit_refund = sale_item.total / sale_item.quantity
                item_refund = unit_refund * return_item.quantity
                total_refund += item_refund
                
                # Create return item
                return_item_record = SaleReturnItem(
                    sale_item_id=sale_item.id,
                    quantity_returned=return_item.quantity,
                    refund_amount=item_refund,
                )
                return_items.append(return_item_record)
                
                # Update sale item's returned quantity
                sale_item.quantity_returned += return_item.quantity
                
                # Update product stock (restore)
                previous_quantity = product.stock_quantity
                new_quantity = previous_quantity + return_item.quantity
                product.stock_quantity = new_quantity
                
                # Create inventory log (will be committed with transaction)
                self.inventory_repo.create_log(
                    product_id=product.id,
                    user_id=user_id,
                    quantity_change=return_item.quantity,
                    previous_quantity=previous_quantity,
                    new_quantity=new_quantity,
                    reason=f"Return from Sale #{sale_id}",
                    reference_type="sale_return",
                    reference_id=None,  # Will update after return is created
                )
            
            # Create sale return record
            sale_return = SaleReturn(
                sale_id=sale_id,
                user_id=user_id,
                total_refund_amount=total_refund,
                refund_method=return_data.refund_method,
                notes=return_data.notes,
            )
            sale_return.items = return_items
            
            self.db.add(sale_return)
            self.db.flush()  # Get the ID
            
            # Step 7: Update sale status
            all_fully_returned = all(
                item.quantity_returned >= item.quantity
                for item in sale.items
            )
            
            if all_fully_returned:
                sale.status = SaleStatus.RETURNED
            else:
                sale.status = SaleStatus.PARTIALLY_RETURNED
            
            # Step 8: Commit transaction
            self.db.commit()
            
            return self._to_response(sale_return)
            
        except Exception as e:
            self.db.rollback()
            raise e

    def get_returns_for_sale(self, sale_id: int) -> list[SaleReturnResponse]:
        """Get all returns for a specific sale."""
        returns = self.db.query(SaleReturn).filter(
            SaleReturn.sale_id == sale_id
        ).all()
        return [self._to_response(r) for r in returns]

    def _to_response(self, sale_return: SaleReturn) -> SaleReturnResponse:
        """Convert SaleReturn model to response schema."""
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
