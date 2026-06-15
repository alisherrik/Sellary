"""Deterministic data-access for the FIFO inventory ledger.

All DB queries for inventory layers, allocations, and ledger inventory logs
live here. Arithmetic and invariant enforcement live in
``services.inventory_ledger_service``; this layer only persists/loads rows and
acquires row locks in a deterministic order.
"""
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from models.inventory_layer import InventoryAllocation, InventoryLayer
from models.inventory_log import InventoryLog


class InventoryLedgerRepository:
    def __init__(self, db: Session):
        self.db = db

    def lock_available_layers(self, company_id: int, product_id: int) -> List[InventoryLayer]:
        """Return non-reversed layers with stock, FIFO ordered, row-locked."""
        return (
            self.db.query(InventoryLayer)
            .filter(
                InventoryLayer.company_id == company_id,
                InventoryLayer.product_id == product_id,
                InventoryLayer.remaining_quantity > 0,
                InventoryLayer.reversed_at.is_(None),
            )
            .order_by(InventoryLayer.created_at, InventoryLayer.id)
            .with_for_update()
            .all()
        )

    def active_allocations_for_layers(self, layer_ids: List[int]) -> List[InventoryAllocation]:
        """Return row-locked allocations on the given layers that still hold stock."""
        if not layer_ids:
            return []
        return (
            self.db.query(InventoryAllocation)
            .filter(
                InventoryAllocation.layer_id.in_(layer_ids),
                InventoryAllocation.quantity > InventoryAllocation.released_quantity,
            )
            .with_for_update()
            .all()
        )

    def allocations_for_sale_item(self, sale_item_id: int) -> List[InventoryAllocation]:
        """Return a sale item's allocations, oldest first (so callers can reverse them)."""
        return (
            self.db.query(InventoryAllocation)
            .filter(InventoryAllocation.sale_item_id == sale_item_id)
            .order_by(InventoryAllocation.id)
            .with_for_update()
            .all()
        )

    def get_layer(self, layer_id: int) -> Optional[InventoryLayer]:
        return (
            self.db.query(InventoryLayer)
            .filter(InventoryLayer.id == layer_id)
            .with_for_update()
            .first()
        )

    def add_layer(
        self,
        *,
        company_id: int,
        product_id: int,
        quantity: Decimal,
        unit_cost: Decimal,
        source_type: str,
        source_id: Optional[int],
        purchase_receipt_item_id: Optional[int] = None,
        reversal_operation_id: Optional[int] = None,
    ) -> InventoryLayer:
        """Persist a new FIFO layer (original == remaining == quantity)."""
        layer = InventoryLayer(
            company_id=company_id,
            product_id=product_id,
            source_type=source_type,
            source_id=source_id,
            purchase_receipt_item_id=purchase_receipt_item_id,
            original_quantity=quantity,
            remaining_quantity=quantity,
            unit_cost=unit_cost,
            reversal_operation_id=reversal_operation_id,
        )
        self.db.add(layer)
        self.db.flush()
        return layer

    def add_allocation(
        self,
        *,
        company_id: int,
        product_id: int,
        layer_id: int,
        consumer_type: str,
        consumer_id: int,
        sale_item_id: Optional[int],
        quantity: Decimal,
    ) -> InventoryAllocation:
        """Persist a consumption allocation against a layer."""
        allocation = InventoryAllocation(
            company_id=company_id,
            product_id=product_id,
            layer_id=layer_id,
            consumer_type=consumer_type,
            consumer_id=consumer_id,
            sale_item_id=sale_item_id,
            quantity=quantity,
            released_quantity=Decimal("0"),
        )
        self.db.add(allocation)
        self.db.flush()
        return allocation

    def create_log(
        self,
        *,
        company_id: int,
        product_id: int,
        user_id: int,
        quantity_change: Decimal,
        value_change: Decimal,
        previous_quantity: Decimal,
        new_quantity: Decimal,
        reason: Optional[str],
        reference_type: Optional[str] = None,
        reference_id: Optional[int] = None,
        reversal_operation_id: Optional[int] = None,
    ) -> InventoryLog:
        """Create a ledger inventory log row (caller manages the transaction)."""
        log = InventoryLog(
            company_id=company_id,
            product_id=product_id,
            user_id=user_id,
            quantity_change=quantity_change,
            value_change=value_change,
            previous_quantity=previous_quantity,
            new_quantity=new_quantity,
            reason=reason,
            reference_type=reference_type,
            reference_id=reference_id,
            reversal_operation_id=reversal_operation_id,
        )
        self.db.add(log)
        self.db.flush()
        return log
