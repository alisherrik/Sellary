from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from core.state_machine import (
    StateTransitionError,
    can_delete_po,
    can_edit_po,
    can_receive_po,
    validate_po_transition,
)
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from repositories.purchase_order_repository import PurchaseOrderRepository
from repositories.supplier_repository import SupplierRepository
from schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderItemResponse,
    PurchaseOrderResponse,
    PurchaseOrderUpdate,
    ReceiveItemsRequest,
)
from services.tenant import resolve_company_id


class PurchaseOrderService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.po_repo = PurchaseOrderRepository(db)
        self.supplier_repo = SupplierRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)

    def get_by_id(self, po_id: int) -> Optional[PurchaseOrderResponse]:
        purchase_order = self.po_repo.get_by_id(self.company_id, po_id)
        if not purchase_order:
            return None
        return self._to_response(purchase_order)

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
            self.company_id,
            skip=skip,
            limit=limit,
            supplier_id=supplier_id,
            status=status,
            start_date=start_dt,
            end_date=end_dt,
        )
        return [self._to_response(purchase_order) for purchase_order in purchase_orders], total

    def create(self, po_create: PurchaseOrderCreate) -> PurchaseOrderResponse:
        supplier = self.supplier_repo.get_by_id(self.company_id, po_create.supplier_id)
        if not supplier:
            raise ValueError(f"Supplier with id {po_create.supplier_id} not found")

        for item in po_create.items:
            product = self.product_repo.get_by_id(self.company_id, item.product_id)
            if not product:
                raise ValueError(f"Product with id {item.product_id} not found")
            if not product.is_active:
                raise ValueError(f"Product {product.name} is not active")

        total_amount = Decimal("0.00")
        po_items: List[PurchaseOrderItem] = []
        for item_data in po_create.items:
            subtotal = item_data.quantity_ordered * item_data.unit_cost
            total_amount += subtotal
            po_items.append(
                PurchaseOrderItem(
                    product_id=item_data.product_id,
                    quantity_ordered=item_data.quantity_ordered,
                    quantity_received=0,
                    unit_cost=item_data.unit_cost,
                    subtotal=subtotal,
                )
            )

        purchase_order = PurchaseOrder(
            company_id=self.company_id,
            supplier_id=po_create.supplier_id,
            expected_delivery_date=po_create.expected_delivery_date,
            notes=po_create.notes,
            status=PurchaseOrderStatus.DRAFT,
            total_amount=total_amount,
        )

        purchase_order = self.po_repo.create_with_items(purchase_order, po_items)
        return self._to_response(purchase_order)

    def update(self, po_id: int, po_update: PurchaseOrderUpdate) -> PurchaseOrderResponse:
        purchase_order = self.po_repo.get_by_id(self.company_id, po_id)
        if not purchase_order:
            raise ValueError(f"Purchase order with id {po_id} not found")

        if not can_edit_po(purchase_order.status):
            raise StateTransitionError(
                entity_type="Purchase Order",
                entity_id=po_id,
                current_status=purchase_order.status.value,
                target_status="edit",
            )

        if po_update.supplier_id:
            supplier = self.supplier_repo.get_by_id(self.company_id, po_update.supplier_id)
            if not supplier:
                raise ValueError(f"Supplier with id {po_update.supplier_id} not found")
            purchase_order.supplier_id = po_update.supplier_id

        if po_update.expected_delivery_date is not None:
            purchase_order.expected_delivery_date = po_update.expected_delivery_date

        if po_update.notes is not None:
            purchase_order.notes = po_update.notes

        if po_update.items:
            total_amount = Decimal("0.00")
            po_items = []
            for item_data in po_update.items:
                product = self.product_repo.get_by_id(self.company_id, item_data.product_id)
                if not product:
                    raise ValueError(f"Product with id {item_data.product_id} not found")
                if not product.is_active:
                    raise ValueError(f"Product {product.name} is not active")

                subtotal = item_data.quantity_ordered * item_data.unit_cost
                total_amount += subtotal
                po_items.append(
                    PurchaseOrderItem(
                        product_id=item_data.product_id,
                        quantity_ordered=item_data.quantity_ordered,
                        quantity_received=0,
                        unit_cost=item_data.unit_cost,
                        subtotal=subtotal,
                    )
                )

            purchase_order.total_amount = total_amount
            self.po_repo.update_items(po_id, po_items)

        purchase_order = self.po_repo.update(purchase_order)
        return self._to_response(purchase_order)

    def send(self, po_id: int) -> PurchaseOrderResponse:
        purchase_order = self.po_repo.get_by_id_for_update(self.company_id, po_id)
        if not purchase_order:
            raise ValueError(f"Purchase order with id {po_id} not found")

        validate_po_transition(
            current_status=purchase_order.status,
            target_status=PurchaseOrderStatus.SENT,
            po_id=po_id,
        )

        purchase_order.status = PurchaseOrderStatus.SENT
        self.db.flush()
        return self._to_response(purchase_order)

    def receive_items(
        self,
        po_id: int,
        receive_request: ReceiveItemsRequest,
        user_id: int,
    ) -> PurchaseOrderResponse:
        purchase_order = self.po_repo.get_by_id_for_update(self.company_id, po_id)
        if not purchase_order:
            raise ValueError(f"Purchase order with id {po_id} not found")

        if not can_receive_po(purchase_order.status):
            raise StateTransitionError(
                entity_type="Purchase Order",
                entity_id=po_id,
                current_status=purchase_order.status.value,
                target_status="receive",
            )

        items_to_receive = {}
        for receive_item in receive_request.items:
            item_id = receive_item.get("item_id")
            quantity_to_receive = Decimal(str(receive_item.get("quantity_to_receive", 0)))
            if quantity_to_receive > 0:
                items_to_receive[item_id] = quantity_to_receive

        if not items_to_receive:
            raise ValueError("No items to receive")

        locked_po_items = self.po_repo.get_po_items_for_update(po_id)
        po_item_map = {item.id: item for item in locked_po_items}

        product_ids = []
        for item_id in items_to_receive:
            po_item = po_item_map.get(item_id)
            if not po_item:
                raise ValueError(f"Purchase order item with id {item_id} not found")
            if po_item.product_id not in product_ids:
                product_ids.append(po_item.product_id)

        product_ids.sort()
        locked_products = self.product_repo.get_multiple_for_update(
            self.company_id,
            product_ids,
        )
        product_map = {product.id: product for product in locked_products}

        all_fully_received = True
        for item_id, quantity_to_receive in items_to_receive.items():
            po_item = po_item_map.get(item_id)
            if not po_item:
                raise ValueError(f"Purchase order item with id {item_id} not found")

            max_receivable = po_item.quantity_ordered - po_item.quantity_received
            if quantity_to_receive > max_receivable:
                raise ValueError(
                    f"Cannot receive {quantity_to_receive} items. "
                    f"Maximum receivable: {max_receivable} "
                    f"(Ordered: {po_item.quantity_ordered}, Already received: {po_item.quantity_received})"
                )

            product = product_map.get(po_item.product_id)
            if not product:
                raise ValueError(f"Product with id {po_item.product_id} not found")

            previous_quantity = product.stock_quantity
            new_quantity = previous_quantity + quantity_to_receive
            product.stock_quantity = new_quantity

            total_cost_before = previous_quantity * product.cost_price
            cost_added = quantity_to_receive * po_item.unit_cost
            product.cost_price = ((total_cost_before + cost_added) / new_quantity).quantize(Decimal("0.01"))

            self.inventory_repo.create_log(
                company_id=self.company_id,
                product_id=product.id,
                user_id=user_id,
                quantity_change=quantity_to_receive,
                previous_quantity=previous_quantity,
                new_quantity=new_quantity,
                reason=f"Restock via PO #{po_id}",
                reference_type="po_receive",
                reference_id=po_id,
            )

            po_item.quantity_received += quantity_to_receive

        for po_item in locked_po_items:
            if po_item.quantity_received < po_item.quantity_ordered:
                all_fully_received = False
                break

        purchase_order.status = (
            PurchaseOrderStatus.RECEIVED
            if all_fully_received
            else PurchaseOrderStatus.PARTIALLY_RECEIVED
        )
        self.db.flush()
        return self._to_response(purchase_order)

    def cancel(self, po_id: int) -> PurchaseOrderResponse:
        purchase_order = self.po_repo.get_by_id_for_update(self.company_id, po_id)
        if not purchase_order:
            raise ValueError(f"Purchase order with id {po_id} not found")

        validate_po_transition(
            current_status=purchase_order.status,
            target_status=PurchaseOrderStatus.CANCELLED,
            po_id=po_id,
        )

        purchase_order.status = PurchaseOrderStatus.CANCELLED
        self.db.flush()
        return self._to_response(purchase_order)

    def delete(self, po_id: int) -> bool:
        purchase_order = self.po_repo.get_by_id(self.company_id, po_id)
        if not purchase_order:
            raise ValueError(f"Purchase order with id {po_id} not found")

        if not can_delete_po(purchase_order.status):
            raise StateTransitionError(
                entity_type="Purchase Order",
                entity_id=po_id,
                current_status=purchase_order.status.value,
                target_status="delete",
            )

        return self.po_repo.delete(self.company_id, po_id)

    def _to_response(self, purchase_order: PurchaseOrder) -> PurchaseOrderResponse:
        return PurchaseOrderResponse(
            id=purchase_order.id,
            supplier_id=purchase_order.supplier_id,
            supplier=(
                {
                    "id": purchase_order.supplier.id,
                    "name": purchase_order.supplier.name,
                }
                if purchase_order.supplier
                else None
            ),
            order_date=purchase_order.order_date,
            expected_delivery_date=purchase_order.expected_delivery_date,
            status=purchase_order.status,
            total_amount=purchase_order.total_amount,
            notes=purchase_order.notes,
            is_active=purchase_order.is_active,
            created_at=purchase_order.created_at,
            updated_at=purchase_order.updated_at,
            items=[
                PurchaseOrderItemResponse(
                    id=item.id,
                    product_id=item.product_id,
                    quantity_ordered=item.quantity_ordered,
                    quantity_received=item.quantity_received,
                    unit_cost=item.unit_cost,
                    subtotal=item.subtotal,
                    product=(
                        {
                            "id": item.product.id,
                            "name": item.product.name,
                            "barcode": item.product.barcode,
                            "uom": item.product.uom,
                        }
                        if item.product
                        else None
                    ),
                )
                for item in purchase_order.items
            ],
        )
