from decimal import Decimal
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from repositories.purchase_order_repository import PurchaseOrderRepository
from repositories.supplier_repository import SupplierRepository
from repositories.product_repository import ProductRepository
from repositories.inventory_repository import InventoryRepository
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderUpdate,
    PurchaseOrderResponse,
    PurchaseOrderItemCreate,
    PurchaseOrderItemResponse,
    ReceiveItemsRequest,
)
from core.state_machine import (
    validate_po_transition,
    can_send_po,
    can_receive_po,
    can_cancel_po,
    can_delete_po,
    can_edit_po,
    StateTransitionError,
)


class PurchaseOrderService:
    def __init__(self, db: Session):
        self.db = db
        self.po_repo = PurchaseOrderRepository(db)
        self.supplier_repo = SupplierRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)

    def get_by_id(self, po_id: int) -> Optional[PurchaseOrderResponse]:
        po = self.po_repo.get_by_id(po_id)
        if not po:
            return None
        return self._to_response(po)

    def get_all(
        self,
        skip: int = 0,
        limit: int = 50,
        supplier_id: Optional[int] = None,
        status: Optional[PurchaseOrderStatus] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Tuple[List[PurchaseOrderResponse], int]:
        from datetime import datetime

        start_dt = datetime.fromisoformat(start_date) if start_date else None
        end_dt = datetime.fromisoformat(end_date) if end_date else None

        purchase_orders, total = self.po_repo.get_all(
            skip=skip,
            limit=limit,
            supplier_id=supplier_id,
            status=status,
            start_date=start_dt,
            end_date=end_dt,
        )
        return [self._to_response(po) for po in purchase_orders], total

    def create(self, po_create: PurchaseOrderCreate) -> PurchaseOrderResponse:
        # Validate supplier exists
        supplier = self.supplier_repo.get_by_id(po_create.supplier_id)
        if not supplier:
            raise ValueError(f"Supplier with id {po_create.supplier_id} not found")

        # Validate all products exist and are active
        product_ids = [item.product_id for item in po_create.items]
        for pid in product_ids:
            product = self.product_repo.get_by_id(pid)
            if not product:
                raise ValueError(f"Product with id {pid} not found")
            if not product.is_active:
                raise ValueError(f"Product {product.name} is not active")

        # Calculate total amount and create PO items
        total_amount = Decimal("0.00")
        po_items = []

        for item_data in po_create.items:
            subtotal = item_data.quantity_ordered * item_data.unit_cost
            total_amount += subtotal

            po_item = PurchaseOrderItem(
                product_id=item_data.product_id,
                quantity_ordered=item_data.quantity_ordered,
                quantity_received=0,
                unit_cost=item_data.unit_cost,
                subtotal=subtotal,
            )
            po_items.append(po_item)

        # Create purchase order
        po = PurchaseOrder(
            supplier_id=po_create.supplier_id,
            expected_delivery_date=po_create.expected_delivery_date,
            notes=po_create.notes,
            status=PurchaseOrderStatus.DRAFT,
            total_amount=total_amount,
        )

        po = self.po_repo.create_with_items(po, po_items)
        return self._to_response(po)

    def update(self, po_id: int, po_update: PurchaseOrderUpdate) -> PurchaseOrderResponse:
        po = self.po_repo.get_by_id(po_id)
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")

        # Only draft orders can be modified
        if not can_edit_po(po.status):
            raise StateTransitionError(
                entity_type="Purchase Order",
                entity_id=po_id,
                current_status=po.status.value,
                target_status="edit"
            )

        # Update supplier if provided
        if po_update.supplier_id:
            supplier = self.supplier_repo.get_by_id(po_update.supplier_id)
            if not supplier:
                raise ValueError(f"Supplier with id {po_update.supplier_id} not found")
            po.supplier_id = po_update.supplier_id

        if po_update.expected_delivery_date is not None:
            po.expected_delivery_date = po_update.expected_delivery_date

        if po_update.notes is not None:
            po.notes = po_update.notes

        # Update items if provided
        if po_update.items:
            # Validate all products exist and are active
            for item_data in po_update.items:
                product = self.product_repo.get_by_id(item_data.product_id)
                if not product:
                    raise ValueError(f"Product with id {item_data.product_id} not found")
                if not product.is_active:
                    raise ValueError(f"Product {product.name} is not active")

            # Recalculate total and update items
            total_amount = Decimal("0.00")
            po_items = []

            for item_data in po_update.items:
                subtotal = item_data.quantity_ordered * item_data.unit_cost
                total_amount += subtotal

                po_item = PurchaseOrderItem(
                    product_id=item_data.product_id,
                    quantity_ordered=item_data.quantity_ordered,
                    quantity_received=0,
                    unit_cost=item_data.unit_cost,
                    subtotal=subtotal,
                )
                po_items.append(po_item)

            po.total_amount = total_amount
            self.po_repo.update_items(po_id, po_items)

        po = self.po_repo.update(po)
        return self._to_response(po)

    def send(self, po_id: int) -> PurchaseOrderResponse:
        po = self.po_repo.get_by_id(po_id)
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")

        # Validate state transition
        validate_po_transition(
            current_status=po.status,
            target_status=PurchaseOrderStatus.SENT,
            po_id=po_id
        )

        po = self.po_repo.update_status(po_id, PurchaseOrderStatus.SENT)
        return self._to_response(po)

    def receive_items(
        self, po_id: int, receive_request: ReceiveItemsRequest, user_id: int
    ) -> PurchaseOrderResponse:
        """
        Receive items from a purchase order with full transactional safety.
        Uses row-level locking (SELECT ... FOR UPDATE) to prevent race conditions.
        """
        try:
            po = self.po_repo.get_by_id(po_id)
            if not po:
                raise ValueError(f"Purchase order with id {po_id} not found")

            # Validate state allows receiving
            if not can_receive_po(po.status):
                raise StateTransitionError(
                    entity_type="Purchase Order",
                    entity_id=po_id,
                    current_status=po.status.value,
                    target_status="receive"
                )

            # Build a map of items to receive
            items_to_receive = {}
            for receive_item in receive_request.items:
                item_id = receive_item.get("item_id")
                quantity_to_receive = receive_item.get("quantity_to_receive", 0)
                if quantity_to_receive > 0:
                    items_to_receive[item_id] = quantity_to_receive

            if not items_to_receive:
                raise ValueError("No items to receive")

            # Collect product IDs for locking
            product_ids = []
            po_item_map = {}
            for po_item in po.items:
                if po_item.id in items_to_receive:
                    product_ids.append(po_item.product_id)
                    po_item_map[po_item.id] = po_item

            # Lock all product rows (ordered by ID to prevent deadlocks)
            locked_products = self.product_repo.get_multiple_for_update(product_ids)
            product_map = {p.id: p for p in locked_products}

            # Process each item to receive
            all_fully_received = True

            for item_id, quantity_to_receive in items_to_receive.items():
                po_item = po_item_map.get(item_id)
                if not po_item:
                    raise ValueError(f"Purchase order item with id {item_id} not found")

                # Validate quantity
                max_receivable = po_item.quantity_ordered - po_item.quantity_received
                if quantity_to_receive > max_receivable:
                    raise ValueError(
                        f"Cannot receive {quantity_to_receive} items. "
                        f"Maximum receivable: {max_receivable} "
                        f"(Ordered: {po_item.quantity_ordered}, Already received: {po_item.quantity_received})"
                    )

                # Update product stock
                product = product_map.get(po_item.product_id)
                if not product:
                    raise ValueError(f"Product with id {po_item.product_id} not found")

                previous_quantity = product.stock_quantity
                new_quantity = previous_quantity + quantity_to_receive
                product.stock_quantity = new_quantity

                # Create inventory log (within same transaction)
                self.inventory_repo.create_log(
                    product_id=product.id,
                    user_id=user_id,
                    quantity_change=quantity_to_receive,
                    previous_quantity=previous_quantity,
                    new_quantity=new_quantity,
                    reason=f"Restock via PO #{po_id}",
                    reference_type="po_receive",
                    reference_id=po_id,
                )

                # Update PO item
                po_item.quantity_received += quantity_to_receive

            # Check if all items are fully received
            for po_item in po.items:
                if po_item.quantity_received < po_item.quantity_ordered:
                    all_fully_received = False
                    break

            # Update PO status
            if all_fully_received:
                po = self.po_repo.update_status(po_id, PurchaseOrderStatus.RECEIVED)
            else:
                po = self.po_repo.update_status(po_id, PurchaseOrderStatus.PARTIALLY_RECEIVED)

            # Commit entire transaction
            self.db.commit()
            return self._to_response(po)

        except Exception as e:
            self.db.rollback()
            raise e

    def cancel(self, po_id: int) -> PurchaseOrderResponse:
        po = self.po_repo.get_by_id(po_id)
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")

        # Validate state transition
        validate_po_transition(
            current_status=po.status,
            target_status=PurchaseOrderStatus.CANCELLED,
            po_id=po_id
        )

        po = self.po_repo.update_status(po_id, PurchaseOrderStatus.CANCELLED)
        return self._to_response(po)

    def delete(self, po_id: int) -> bool:
        po = self.po_repo.get_by_id(po_id)
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")

        # Only draft orders can be deleted
        if not can_delete_po(po.status):
            raise StateTransitionError(
                entity_type="Purchase Order",
                entity_id=po_id,
                current_status=po.status.value,
                target_status="delete"
            )

        return self.po_repo.delete(po_id)

    def _to_response(self, po: PurchaseOrder) -> PurchaseOrderResponse:
        return PurchaseOrderResponse(
            id=po.id,
            supplier_id=po.supplier_id,
            supplier={
                "id": po.supplier.id,
                "name": po.supplier.name,
            } if po.supplier else None,
            order_date=po.order_date,
            expected_delivery_date=po.expected_delivery_date,
            status=po.status,
            total_amount=po.total_amount,
            notes=po.notes,
            is_active=po.is_active,
            created_at=po.created_at,
            updated_at=po.updated_at,
            items=[
                PurchaseOrderItemResponse(
                    id=item.id,
                    product_id=item.product_id,
                    quantity_ordered=item.quantity_ordered,
                    quantity_received=item.quantity_received,
                    unit_cost=item.unit_cost,
                    subtotal=item.subtotal,
                    product={
                        "id": item.product.id,
                        "name": item.product.name,
                        "barcode": item.product.barcode,
                    } if item.product else None,
                )
                for item in po.items
            ],
        )
