"""Single source of truth for inventory quantity/value arithmetic.

Every change to a product's stock and inventory value flows through this
service so the FIFO ledger (layers + allocations), the product balance, and the
inventory_logs audit trail stay consistent. Later tasks route product creation,
adjustments, purchase receipts, sales, returns, and reversals through here.

Layering: this service owns arithmetic and invariants; all DB access is
delegated to ``InventoryLedgerRepository``.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from models.inventory_layer import InventoryAllocation
from models.product import Product
from models.sale_item import SaleItem
from repositories.inventory_ledger_repository import InventoryLedgerRepository

MONEY_QUANT = Decimal("0.0001")
PRICE_QUANT = Decimal("0.01")


@dataclass
class InventoryConsumption:
    """Result of a FIFO consumption: the allocations created and their cost."""

    allocations: List[InventoryAllocation] = field(default_factory=list)
    value: Decimal = Decimal("0.0000")


class InventoryLedgerService:
    def __init__(self, db: Session, company_id: int):
        self.db = db
        self.company_id = company_id
        self.repo = InventoryLedgerRepository(db)

    # ------------------------------------------------------------------
    # Balance arithmetic — the ONLY place stock_quantity / inventory_value
    # / cost_price are mutated.
    # ------------------------------------------------------------------
    def _apply_balance(
        self, product: Product, quantity_change: Decimal, value_change: Decimal
    ) -> tuple[Decimal, Decimal]:
        """Apply a quantity/value delta to the product, enforcing invariants.

        Returns ``(previous_quantity, new_quantity)`` so the caller can write a
        consistent inventory log.
        """
        previous_quantity = Decimal(product.stock_quantity or 0)
        new_quantity = previous_quantity + quantity_change
        new_value = (Decimal(product.inventory_value or 0) + value_change).quantize(MONEY_QUANT)
        if new_quantity < 0:
            raise ValueError(f"Insufficient stock for product '{product.name}'")
        if new_value < Decimal("-0.0001"):
            raise ValueError(f"Inventory value cannot become negative for '{product.name}'")

        product.stock_quantity = new_quantity
        product.inventory_value = max(new_value, Decimal("0.0000"))
        if new_quantity > 0:
            product.cost_price = (product.inventory_value / new_quantity).quantize(PRICE_QUANT)
        else:
            product.inventory_value = Decimal("0.0000")
        return previous_quantity, new_quantity

    # ------------------------------------------------------------------
    # Layer creation (receipts, opening balances, reversal restocks, ...)
    # ------------------------------------------------------------------
    def add_layer(
        self,
        product: Product,
        quantity: Decimal,
        unit_cost: Decimal,
        source_type: str,
        source_id: Optional[int],
        user_id: int,
        reason: Optional[str] = None,
        reference_type: Optional[str] = None,
        reference_id: Optional[int] = None,
        purchase_receipt_item_id: Optional[int] = None,
        reversal_operation_id: Optional[int] = None,
    ) -> Product:
        """Add a FIFO layer and apply its quantity/value to the product balance."""
        quantity = Decimal(quantity)
        unit_cost = Decimal(unit_cost)
        value_change = (quantity * unit_cost).quantize(MONEY_QUANT)

        self.repo.add_layer(
            company_id=self.company_id,
            product_id=product.id,
            quantity=quantity,
            unit_cost=unit_cost,
            source_type=source_type,
            source_id=source_id,
            purchase_receipt_item_id=purchase_receipt_item_id,
            reversal_operation_id=reversal_operation_id,
        )

        previous_quantity, new_quantity = self._apply_balance(product, quantity, value_change)

        self.repo.create_log(
            company_id=self.company_id,
            product_id=product.id,
            user_id=user_id,
            quantity_change=quantity,
            value_change=value_change,
            previous_quantity=previous_quantity,
            new_quantity=new_quantity,
            reason=reason if reason is not None else f"Layer added ({source_type})",
            reference_type=reference_type if reference_type is not None else source_type,
            reference_id=reference_id if reference_id is not None else source_id,
            reversal_operation_id=reversal_operation_id,
        )
        self.db.flush()
        return product

    # ------------------------------------------------------------------
    # FIFO consumption (sales and other consumers)
    # ------------------------------------------------------------------
    def consume_fifo(
        self,
        product: Product,
        quantity: Decimal,
        consumer_type: str,
        consumer_id: int,
        sale_item_id: Optional[int],
        user_id: int,
        reason: Optional[str],
        reference_type: Optional[str],
        reference_id: Optional[int],
    ) -> InventoryConsumption:
        """Consume ``quantity`` units FIFO, creating one allocation per layer."""
        quantity = Decimal(quantity)
        layers = self.repo.lock_available_layers(self.company_id, product.id)

        available = sum((layer.remaining_quantity for layer in layers), Decimal("0"))
        if available < quantity:
            raise ValueError(f"Insufficient stock for product '{product.name}'")

        allocations: List[InventoryAllocation] = []
        total_value = Decimal("0")
        remaining_to_consume = quantity

        for layer in layers:
            if remaining_to_consume <= 0:
                break
            take = min(layer.remaining_quantity, remaining_to_consume)
            if take <= 0:
                continue

            layer.remaining_quantity = layer.remaining_quantity - take
            allocation = self.repo.add_allocation(
                company_id=self.company_id,
                product_id=product.id,
                layer_id=layer.id,
                consumer_type=consumer_type,
                consumer_id=consumer_id,
                sale_item_id=sale_item_id,
                quantity=take,
            )
            allocations.append(allocation)
            total_value += take * layer.unit_cost
            remaining_to_consume -= take

        value = total_value.quantize(MONEY_QUANT)

        previous_quantity, new_quantity = self._apply_balance(product, -quantity, -value)

        self.repo.create_log(
            company_id=self.company_id,
            product_id=product.id,
            user_id=user_id,
            quantity_change=-quantity,
            value_change=-value,
            previous_quantity=previous_quantity,
            new_quantity=new_quantity,
            reason=reason,
            reference_type=reference_type,
            reference_id=reference_id,
        )
        self.db.flush()
        return InventoryConsumption(allocations=allocations, value=value)

    # ------------------------------------------------------------------
    # Release (void/return) — restore consumed units back into their layers
    # ------------------------------------------------------------------
    def release_sale_item(
        self,
        sale_item: SaleItem,
        quantity: Decimal,
        user_id: int,
        reason: Optional[str],
        reference_type: Optional[str],
        reference_id: Optional[int],
        reversal_operation_id: Optional[int] = None,
    ) -> Decimal:
        """Restore ``quantity`` consumed units to a sale item's source layers.

        Walks the sale item's allocations in REVERSE order (most-recently
        consumed layer first), un-releasing each allocation and crediting the
        source layer's ``remaining_quantity``. The restored value is derived
        from each source layer's unit_cost, so callers never pass a separately
        rounded value. Returns the total quantity actually restored.
        """
        quantity = Decimal(quantity)
        allocations = self.repo.allocations_for_sale_item(sale_item.id)

        restored_qty = Decimal("0")
        restored_value = Decimal("0")
        remaining_to_restore = quantity

        for allocation in reversed(allocations):
            if remaining_to_restore <= 0:
                break
            releasable = Decimal(allocation.quantity) - Decimal(allocation.released_quantity)
            if releasable <= 0:
                continue
            take = min(releasable, remaining_to_restore)

            allocation.released_quantity = Decimal(allocation.released_quantity) + take

            layer = self.repo.get_layer(allocation.layer_id)
            layer.remaining_quantity = Decimal(layer.remaining_quantity) + take

            restored_qty += take
            restored_value += take * Decimal(layer.unit_cost)
            remaining_to_restore -= take

        if restored_qty <= 0:
            return restored_qty

        restored_value = restored_value.quantize(MONEY_QUANT)
        product = sale_item.product

        previous_quantity, new_quantity = self._apply_balance(product, restored_qty, restored_value)

        self.repo.create_log(
            company_id=self.company_id,
            product_id=product.id,
            user_id=user_id,
            quantity_change=restored_qty,
            value_change=restored_value,
            previous_quantity=previous_quantity,
            new_quantity=new_quantity,
            reason=reason,
            reference_type=reference_type,
            reference_id=reference_id,
            reversal_operation_id=reversal_operation_id,
        )
        self.db.flush()
        return restored_qty
