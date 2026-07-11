"""Transaction reversal (annulment / void) service.

A focused service that previews and executes the annulment of completed sales
(Task 7) and — in a later task — received purchases (Task 8). Annulment is the
admin-only "undo" for documents that can no longer be plain-cancelled: it
reverses the document's effect on the FIFO inventory ledger (releasing the
exact allocations a sale consumed, or reversing the layers a purchase created),
records an immutable ``ReversalOperation`` for audit/reporting, and flips the
document into a terminal cancelled state with void audit metadata.

Layering: this service orchestrates the ledger service (arithmetic/invariants)
and the sale repository (locking/loads); it does not touch the DB directly
except to add the ``ReversalOperation`` row and set audit columns.

Reuse note (Task 8): ``_create_operation`` and the ``InventoryImpact`` /
blocker plumbing are intentionally generic so the purchase-void path can build
on the same operation record and preview shape. The ``ReversalOperation.impact``
JSON is the canonical audit/report payload — see ``_serialize_impacts``.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from core.state_machine import StateTransitionError, validate_sale_transition
from models.inventory_layer import InventoryAllocation
from models.purchase_order import PurchaseOrderStatus
from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from models.reversal_operation import ReversalOperation
from models.sale import Sale, SaleStatus
from repositories.product_repository import ProductRepository
from repositories.purchase_order_repository import PurchaseOrderRepository
from repositories.sale_repository import SaleRepository
from schemas.reversal import InventoryImpact, ReversalBlocker, VoidPreview, VoidResult
from services.inventory_ledger_service import (
    INTERNAL_WRITEOFF_CONSUMER_TYPES,
    InventoryLedgerService,
)
from services.customer_ledger_service import CustomerLedgerService
from services.tenant import resolve_company_id

MONEY_QUANT = Decimal("0.0001")


class ReversalConflict(Exception):
    """Raised when a document cannot be annulled because of its lifecycle.

    Covers the already-annulled case and any other state conflict (e.g. an
    invalid status transition). Maps to HTTP 409 at the API layer.
    """

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class ReversalBlocked(Exception):
    """Raised when an annulment is blocked by concrete downstream consumption.

    Used by the purchase-void path (Task 8): the received stock has since been
    sold or adjusted, so the purchase cannot be reversed until those documents
    are reversed first. Carries the list of :class:`ReversalBlocker`s so the
    API can surface actionable links. Maps to HTTP 409.
    """

    def __init__(self, blockers: List[ReversalBlocker]):
        self.blockers = list(blockers)
        self.message = "Операцию нельзя отменить: остаток уже использован."
        super().__init__(self.message)

    def to_response(self) -> dict:
        """Serializable 409 detail payload listing the blockers."""
        return {
            "message": self.message,
            "blockers": [blocker.model_dump(mode="json") for blocker in self.blockers],
        }


class TransactionReversalService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.po_repo = PurchaseOrderRepository(db)
        self.ledger = InventoryLedgerService(db, self.company_id)
        self.customer_ledger = CustomerLedgerService(db, self.company_id)

    # ------------------------------------------------------------------
    # Sale annulment
    # ------------------------------------------------------------------
    def preview_sale(self, sale_id: int) -> VoidPreview:
        """Compute the impact of annulling ``sale_id`` WITHOUT mutating anything.

        ``can_void`` is True unless the sale is already annulled. ``is_legacy``
        is True when any outstanding item lacks FIFO allocations (a pre-ledger
        sale that will be restocked via a fresh ``sale_void`` layer). Sales have
        no blockers — only purchases do — so ``blockers`` is always empty here.
        """
        sale = self.sale_repo.get_by_id(self.company_id, sale_id)
        if not sale:
            raise ValueError(f"Sale with id {sale_id} not found")

        can_void = (
            not self._is_voided(sale)
            and sale.status in (SaleStatus.COMPLETED, SaleStatus.PARTIALLY_RETURNED)
        )
        impacts: List[InventoryImpact] = []
        is_legacy = False

        for item in sale.items:
            outstanding = Decimal(item.quantity) - Decimal(item.quantity_returned or 0)
            if outstanding <= 0:
                continue
            if not item.allocations:
                is_legacy = True
                unit_cost = Decimal(item.unit_cost_at_sale or 0)
                value_change = (outstanding * unit_cost).quantize(MONEY_QUANT)
            else:
                value_change = self._allocation_release_value(item, outstanding)
            resulting_stock = Decimal(item.product.stock_quantity or 0) + outstanding
            impacts.append(
                InventoryImpact(
                    product_id=item.product_id,
                    product_name=item.product.name,
                    quantity_change=outstanding,
                    value_change=value_change,
                    resulting_stock=resulting_stock,
                )
            )

        return VoidPreview(
            can_void=can_void,
            is_legacy=is_legacy,
            impacts=impacts,
            blockers=[],
        )

    def void_sale(self, sale_id: int, reason: str, user_id: int) -> VoidResult:
        """Annul a completed/returned sale, restoring ONLY outstanding stock.

        Locks the sale, its items and their products; rejects an already-voided
        sale; records a ``ReversalOperation``; then for each item restores the
        outstanding quantity (sold minus already-returned) back to the ledger —
        releasing the original allocations when present, or adding a fresh
        ``sale_void`` layer for legacy items. Finally marks the sale CANCELLED
        and stamps the void audit fields.
        """
        sale = self.sale_repo.get_by_id_for_update(self.company_id, sale_id)
        if not sale:
            raise ValueError(f"Sale with id {sale_id} not found")

        if self._is_voided(sale):
            raise ReversalConflict("Продажа уже аннулирована.")

        # CANCELLED is reachable from COMPLETED / PARTIALLY_RETURNED but not from
        # the terminal RETURNED/CANCELLED states. Surface that as a conflict.
        try:
            validate_sale_transition(
                current_status=sale.status,
                target_status=SaleStatus.CANCELLED,
                sale_id=sale_id,
            )
        except StateTransitionError as exc:
            raise ReversalConflict(exc.message) from exc

        locked_items = self.sale_repo.get_sale_items_for_update(sale_id)
        product_ids = sorted({item.product_id for item in locked_items})
        locked_products = self.product_repo.get_multiple_for_update(
            self.company_id,
            product_ids,
        )
        product_map = {product.id: product for product in locked_products}

        # Build the audit impact up front (pre-mutation projection) so it
        # reflects the intended effect and is identical to the preview.
        impacts: List[InventoryImpact] = []
        is_legacy = False
        outstanding_by_item: dict[int, Decimal] = {}
        for item in locked_items:
            outstanding = Decimal(item.quantity) - Decimal(item.quantity_returned or 0)
            outstanding_by_item[item.id] = outstanding
            if outstanding <= 0:
                continue
            product = product_map[item.product_id]
            if not item.allocations:
                is_legacy = True
                unit_cost = Decimal(item.unit_cost_at_sale or 0)
                value_change = (outstanding * unit_cost).quantize(MONEY_QUANT)
            else:
                value_change = self._allocation_release_value(item, outstanding)
            impacts.append(
                InventoryImpact(
                    product_id=item.product_id,
                    product_name=product.name,
                    quantity_change=outstanding,
                    value_change=value_change,
                    resulting_stock=Decimal(product.stock_quantity or 0) + outstanding,
                )
            )

        operation = self._create_operation(
            entity_type="sale",
            entity_id=sale.id,
            operation_type="sale_void",
            reason=reason,
            user_id=user_id,
            impacts=impacts,
            is_legacy=is_legacy,
        )

        for item in locked_items:
            outstanding = outstanding_by_item[item.id]
            if outstanding <= 0:
                continue
            product = product_map[item.product_id]
            if not item.allocations:
                self.ledger.add_layer(
                    product=product,
                    quantity=outstanding,
                    unit_cost=item.unit_cost_at_sale,
                    source_type="sale_void",
                    source_id=item.id,
                    user_id=user_id,
                    reason=f"Аннулирование продажи #{sale.id}: {reason}",
                    reference_type="sale_void",
                    reference_id=sale.id,
                    reversal_operation_id=operation.id,
                )
            else:
                restored = self.ledger.release_sale_item(
                    item,
                    outstanding,
                    user_id,
                    f"Аннулирование продажи #{sale.id}: {reason}",
                    "sale_void",
                    sale.id,
                    operation.id,
                )
                if restored < outstanding:
                    # The allocations could not return the full outstanding
                    # quantity — the ledger is inconsistent with the recorded
                    # sale. Fail loudly rather than silently under-restock.
                    raise ValueError(
                        f"Sale item {item.id}: released {restored} of {outstanding} "
                        f"outstanding units; ledger allocations are inconsistent."
                    )

        voided_at = datetime.now(timezone.utc)
        sale.status = SaleStatus.CANCELLED
        sale.voided_at = voided_at
        sale.voided_by_user_id = user_id
        sale.void_reason = reason
        sale.reversal_operation_id = operation.id
        self.customer_ledger.record_cancel_adjustment(
            sale,
            user_id,
            description=f"Аннулирование продажи #{sale.id}: {reason}",
        )
        self.db.flush()

        return VoidResult(
            operation_id=operation.id,
            entity_type="sale",
            entity_id=sale.id,
            status=sale.status.value,
            voided_at=sale.voided_at or voided_at,
        )

    # ------------------------------------------------------------------
    # Purchase annulment
    # ------------------------------------------------------------------
    def preview_purchase(self, po_id: int, for_update: bool = False) -> VoidPreview:
        po = (
            self.po_repo.get_by_id_for_update(self.company_id, po_id)
            if for_update
            else self.po_repo.get_by_id(self.company_id, po_id)
        )
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")
        if po.voided_at is not None:
            return VoidPreview(can_void=False, is_legacy=False, impacts=[], blockers=[])

        receipts = (
            self.db.query(PurchaseReceipt)
            .filter(
                PurchaseReceipt.company_id == self.company_id,
                PurchaseReceipt.purchase_order_id == po_id,
                PurchaseReceipt.reversed_at.is_(None),
            )
            .all()
        )
        received_quantity = sum(
            (Decimal(item.quantity_received or 0) for item in po.items), Decimal("0")
        )
        if received_quantity > 0 and not receipts:
            first_item = po.items[0]
            blocker = ReversalBlocker(
                blocker_type="legacy_history",
                reference_id=po.id,
                product_id=first_item.product_id,
                product_name=first_item.product.name,
                quantity=received_quantity,
                created_at=po.created_at,
                message="История этой закупки создана до включения точного учёта партий.",
            )
            return VoidPreview(can_void=False, is_legacy=True, impacts=[], blockers=[blocker])

        receipt_items = [item for receipt in receipts for item in receipt.items]
        impacts, blockers = self._layer_impacts_and_blockers(receipt_items)

        allowed_status = po.status in (
            PurchaseOrderStatus.PARTIALLY_RECEIVED,
            PurchaseOrderStatus.RECEIVED,
        )
        return VoidPreview(
            can_void=allowed_status and not blockers and bool(receipt_items),
            is_legacy=False,
            impacts=impacts,
            blockers=blockers,
        )

    def _layer_impacts_and_blockers(
        self, receipt_items: List[PurchaseReceiptItem]
    ) -> tuple[List[InventoryImpact], List[ReversalBlocker]]:
        """Project the stock/value impact and detect blockers for a set of
        receipt items' inventory layers.

        Shared by whole-purchase and single-line previews so both compute the
        same impacts and the same blocker vocabulary. Internal write-offs
        (product delete/recreate) are auto-released by the void and net against
        the layer removal; active sale or manual-adjustment allocations are hard
        blockers. Sale blockers carry the exact ``sale_item_id`` when known.
        """
        impacts: List[InventoryImpact] = []
        blockers: List[ReversalBlocker] = []
        for item in receipt_items:
            layer = item.inventory_layer
            if not layer or layer.reversed_at is not None:
                continue
            product = item.product
            active_allocations = (
                self.db.query(InventoryAllocation)
                .filter(
                    InventoryAllocation.layer_id == layer.id,
                    InventoryAllocation.quantity > InventoryAllocation.released_quantity,
                )
                .all()
            )
            writeoff_release = Decimal("0")
            for allocation in active_allocations:
                remaining = Decimal(allocation.quantity) - Decimal(allocation.released_quantity)
                if allocation.consumer_type in INTERNAL_WRITEOFF_CONSUMER_TYPES:
                    # A product delete/recreate write-off — the void releases it
                    # automatically, so it is not a blocker. Its units flow back
                    # into the layer before the reversal, netting against it.
                    writeoff_release += remaining
                    continue
                sale_item = allocation.sale_item
                if sale_item is not None:
                    blockers.append(
                        ReversalBlocker(
                            blocker_type="sale",
                            reference_id=sale_item.sale_id,
                            sale_item_id=sale_item.id,
                            product_id=product.id,
                            product_name=product.name,
                            quantity=remaining,
                            created_at=sale_item.sale.created_at,
                            message=f"Сначала аннулируйте продажу #{sale_item.sale_id}.",
                        )
                    )
                else:
                    blockers.append(
                        ReversalBlocker(
                            blocker_type="inventory_adjustment",
                            reference_id=allocation.consumer_id,
                            product_id=product.id,
                            product_name=product.name,
                            quantity=remaining,
                            created_at=allocation.created_at,
                            message="Остаток использован последующей корректировкой.",
                        )
                    )

            # Net effect of voiding this layer on the product balance: the
            # reversal removes the layer's received quantity, while any released
            # write-off restores its consumed units first.
            net_quantity = writeoff_release - Decimal(item.quantity)
            impacts.append(
                InventoryImpact(
                    product_id=product.id,
                    product_name=product.name,
                    quantity_change=net_quantity,
                    value_change=(net_quantity * Decimal(item.unit_cost)).quantize(MONEY_QUANT),
                    resulting_stock=Decimal(product.stock_quantity) + net_quantity,
                )
            )
        return impacts, blockers

    # ------------------------------------------------------------------
    # Purchase line (item-scoped) annulment
    # ------------------------------------------------------------------
    def _active_receipt_items_for_po_item(
        self, item_id: int
    ) -> List[PurchaseReceiptItem]:
        """Receipt items for a single PO line whose parent receipt is not
        reversed — the traceable receipt layers created for that line."""
        return (
            self.db.query(PurchaseReceiptItem)
            .join(
                PurchaseReceipt,
                PurchaseReceiptItem.purchase_receipt_id == PurchaseReceipt.id,
            )
            .filter(
                PurchaseReceipt.company_id == self.company_id,
                PurchaseReceipt.reversed_at.is_(None),
                PurchaseReceiptItem.purchase_order_item_id == item_id,
            )
            .order_by(PurchaseReceiptItem.id)
            .all()
        )

    def preview_purchase_item(
        self, po_id: int, item_id: int, for_update: bool = False
    ) -> VoidPreview:
        """Preview annulling ONE received purchase line, inspecting only the
        unreversed receipt-item layers linked to that line.

        Returns ``can_void=False`` for an already-voided or unreceived line. A
        received line whose receipt layers are missing/all-reversed is treated as
        legacy history and blocked. Otherwise the same stock/value impact and
        blocker vocabulary as the whole-purchase preview apply, scoped to this
        line's layers only.
        """
        po = (
            self.po_repo.get_by_id_for_update(self.company_id, po_id)
            if for_update
            else self.po_repo.get_by_id(self.company_id, po_id)
        )
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")

        item = next((i for i in po.items if i.id == item_id), None)
        if item is None:
            raise ValueError(f"Purchase order item with id {item_id} not found")

        if item.voided_at is not None:
            return VoidPreview(can_void=False, is_legacy=False, impacts=[], blockers=[])

        received_quantity = Decimal(item.quantity_received or 0)
        if received_quantity <= 0:
            # Nothing was received for this line — there is no stock to reverse.
            return VoidPreview(can_void=False, is_legacy=False, impacts=[], blockers=[])

        receipt_items = self._active_receipt_items_for_po_item(item_id)
        active_layer_items = [
            ri
            for ri in receipt_items
            if ri.inventory_layer is not None and ri.inventory_layer.reversed_at is None
        ]
        if not active_layer_items:
            # Received but no traceable, unreversed layer — a pre-ledger line.
            blocker = ReversalBlocker(
                blocker_type="legacy_history",
                reference_id=item.id,
                product_id=item.product_id,
                product_name=item.product.name,
                quantity=received_quantity,
                created_at=po.created_at,
                message="История этой позиции создана до включения точного учёта партий.",
            )
            return VoidPreview(can_void=False, is_legacy=True, impacts=[], blockers=[blocker])

        impacts, blockers = self._layer_impacts_and_blockers(active_layer_items)
        allowed_status = po.status in (
            PurchaseOrderStatus.PARTIALLY_RECEIVED,
            PurchaseOrderStatus.RECEIVED,
        )
        return VoidPreview(
            can_void=allowed_status and not blockers,
            is_legacy=False,
            impacts=impacts,
            blockers=blockers,
        )

    def void_purchase_item(
        self, po_id: int, item_id: int, reason: str, user_id: int
    ) -> VoidResult:
        """Annul ONE received purchase line, reversing only its receipt layers.

        Locks the purchase, the target line, its receipt items, inventory
        layers, active allocations and affected products. Rejects an
        already-annulled or unreceived line; raises ``ReversalBlocked`` while any
        of the line's stock is still allocated to a sale or manual adjustment.
        On success it releases internal write-offs, reverses each unconsumed
        layer, records one ``purchase_item_void`` operation, marks the line
        annulled, and recomputes the purchase net total/status from the
        remaining active lines — all in the same transaction. Sibling lines and
        their layers are untouched.
        """
        po = self.po_repo.get_by_id_for_update(self.company_id, po_id)
        if not po:
            raise ValueError(f"Purchase order with id {po_id} not found")

        locked_items = self.po_repo.get_po_items_for_update(po_id)
        item = next((i for i in locked_items if i.id == item_id), None)
        if item is None:
            raise ValueError(f"Purchase order item with id {item_id} not found")
        if item.voided_at is not None:
            raise ReversalConflict("Позиция закупки уже аннулирована.")

        preview = self.preview_purchase_item(po_id, item_id, for_update=False)
        if preview.blockers:
            raise ReversalBlocked(preview.blockers)
        if not preview.can_void:
            raise ReversalConflict(
                "Позицию закупки нельзя аннулировать в текущем состоянии."
            )

        receipt_items = self._active_receipt_items_for_po_item(item_id)

        # Deterministically lock the affected layers, their allocations and
        # products so a concurrent sale/void cannot move the same stock twice.
        layer_ids = sorted(
            ri.inventory_layer.id
            for ri in receipt_items
            if ri.inventory_layer is not None
        )
        locked_layers = {lid: self.ledger.repo.get_layer(lid) for lid in layer_ids}
        self.ledger.repo.active_allocations_for_layers(layer_ids)
        product_ids = sorted({ri.product_id for ri in receipt_items})
        locked_products = self.product_repo.get_multiple_for_update(
            self.company_id, product_ids
        )
        product_map = {product.id: product for product in locked_products}

        operation = self._create_operation(
            entity_type="purchase_order_item",
            entity_id=item.id,
            operation_type="purchase_item_void",
            reason=reason,
            user_id=user_id,
            impacts=preview.impacts,
        )

        for ri in receipt_items:
            layer = locked_layers.get(
                ri.inventory_layer.id if ri.inventory_layer else None
            )
            if layer is None or layer.reversed_at is not None:
                continue
            product = product_map[ri.product_id]
            # Release any internal write-off (product delete/recreate) that
            # consumed this layer first, then reverse the now-unconsumed layer.
            # Sale/manual allocations are never released here — the preview
            # blocks the void while those exist.
            self.ledger.release_internal_writeoffs(
                layer=layer,
                product=product,
                user_id=user_id,
                reason=f"Аннулирование позиции закупки #{po.id}: возврат списания",
                reference_type="po_item_void",
                reference_id=po.id,
                reversal_operation_id=operation.id,
            )
            self.ledger.reverse_unconsumed_layer(
                layer=layer,
                product=product,
                user_id=user_id,
                reason=f"Аннулирование позиции закупки #{po.id}: {reason}",
                reference_type="po_item_void",
                reference_id=po.id,
                reversal_operation_id=operation.id,
            )

        now = datetime.now(timezone.utc)
        item.voided_at = now
        item.voided_by_user_id = user_id
        item.void_reason = reason
        item.reversal_operation_id = operation.id
        self._recompute_po_after_item_void(po, locked_items)
        self.db.flush()
        return VoidResult(
            operation_id=operation.id,
            entity_type="purchase_order",
            entity_id=po.id,
            status=po.status.value,
            voided_at=now,
        )

    @staticmethod
    def _recompute_po_after_item_void(po, items) -> None:
        """Recompute the purchase net total and lifecycle status from the
        remaining active (non-voided) lines. All lines voided → CANCELLED;
        otherwise RECEIVED when every active line is fully received, else
        PARTIALLY_RECEIVED. Voided lines keep their original figures for audit."""
        active = [i for i in items if i.voided_at is None]
        if not active:
            po.status = PurchaseOrderStatus.CANCELLED
            po.total_amount = Decimal("0.00")
            return
        po.total_amount = sum(
            (Decimal(i.subtotal or 0) for i in active), Decimal("0.00")
        )
        all_received = all(
            Decimal(i.quantity_received or 0) >= Decimal(i.quantity_ordered)
            for i in active
        )
        po.status = (
            PurchaseOrderStatus.RECEIVED
            if all_received
            else PurchaseOrderStatus.PARTIALLY_RECEIVED
        )

    def void_purchase(self, po_id: int, reason: str, user_id: int) -> VoidResult:
        preview = self.preview_purchase(po_id, for_update=True)
        if preview.blockers:
            raise ReversalBlocked(preview.blockers)
        if not preview.can_void:
            raise ReversalConflict("Закупку нельзя аннулировать в текущем состоянии.")

        po = self.po_repo.get_by_id_for_update(self.company_id, po_id)
        receipts = (
            self.db.query(PurchaseReceipt)
            .filter(
                PurchaseReceipt.company_id == self.company_id,
                PurchaseReceipt.purchase_order_id == po_id,
                PurchaseReceipt.reversed_at.is_(None),
            )
            .with_for_update()
            .all()
        )
        operation = self._create_operation(
            entity_type="purchase_order",
            entity_id=po.id,
            operation_type="purchase_void",
            reason=reason,
            user_id=user_id,
            impacts=preview.impacts,
        )
        now = datetime.now(timezone.utc)
        for receipt in receipts:
            for item in receipt.items:
                layer = item.inventory_layer
                if not layer or layer.reversed_at is not None:
                    continue
                # Release any internal write-off (product delete/recreate) that
                # consumed this layer, restoring it to fully unconsumed so the
                # reversal below can remove it. Sale/manual allocations are not
                # released here — the preview blocks the void while those exist.
                self.ledger.release_internal_writeoffs(
                    layer=layer,
                    product=item.product,
                    user_id=user_id,
                    reason=f"Аннулирование закупки #{po.id}: возврат списания",
                    reference_type="po_void",
                    reference_id=po.id,
                    reversal_operation_id=operation.id,
                )
                self.ledger.reverse_unconsumed_layer(
                    layer=layer,
                    product=item.product,
                    user_id=user_id,
                    reason=f"Аннулирование закупки #{po.id}: {reason}",
                    reference_type="po_void",
                    reference_id=po.id,
                    reversal_operation_id=operation.id,
                )
            receipt.reversed_at = now
            receipt.reversal_operation_id = operation.id

        po.status = PurchaseOrderStatus.CANCELLED
        po.voided_at = now
        po.voided_by_user_id = user_id
        po.void_reason = reason
        po.reversal_operation_id = operation.id
        self.db.flush()
        return VoidResult(
            operation_id=operation.id,
            entity_type="purchase_order",
            entity_id=po.id,
            status=po.status.value,
            voided_at=now,
        )

    # ------------------------------------------------------------------
    # Shared helpers (reused by the purchase-void path in Task 8)
    # ------------------------------------------------------------------
    def _create_operation(
        self,
        *,
        entity_type: str,
        entity_id: int,
        operation_type: str,
        reason: str,
        user_id: int,
        impacts: List[InventoryImpact],
        is_legacy: bool = False,
        blockers: Optional[List[ReversalBlocker]] = None,
    ) -> ReversalOperation:
        """Persist a ReversalOperation with a canonical audit/report impact JSON."""
        operation = ReversalOperation(
            company_id=self.company_id,
            entity_type=entity_type,
            entity_id=entity_id,
            operation_type=operation_type,
            reason=reason,
            user_id=user_id,
            impact=self._serialize_impact(
                entity_type=entity_type,
                entity_id=entity_id,
                impacts=impacts,
                is_legacy=is_legacy,
                blockers=blockers or [],
            ),
        )
        self.db.add(operation)
        self.db.flush()
        return operation

    @staticmethod
    def _serialize_impact(
        *,
        entity_type: str,
        entity_id: int,
        impacts: List[InventoryImpact],
        is_legacy: bool,
        blockers: List[ReversalBlocker],
    ) -> dict:
        """The JSON stored on ReversalOperation.impact.

        Shape (stable contract for reports/audit and the Task 8 purchase path)::

            {
              "entity_type": "sale" | "purchase_order",
              "entity_id": int,
              "is_legacy": bool,
              "impacts": [ {product_id, product_name, quantity_change,
                            value_change, resulting_stock}, ... ],
              "blockers": [ ... ]   # always [] for sales
            }

        Decimals are serialized as strings (``mode="json"``) so the JSON column
        round-trips losslessly.
        """
        return {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "is_legacy": is_legacy,
            "impacts": [impact.model_dump(mode="json") for impact in impacts],
            "blockers": [blocker.model_dump(mode="json") for blocker in blockers],
        }

    def _allocation_release_value(self, item, quantity: Decimal) -> Decimal:
        """Project the value that releasing ``quantity`` from an item's
        allocations would restore, walking them in reverse (most-recent first)
        to mirror ``InventoryLedgerService.release_sale_item`` — without mutating.
        """
        quantity = Decimal(quantity)
        remaining = quantity
        value = Decimal("0")
        for allocation in reversed(list(item.allocations)):
            if remaining <= 0:
                break
            releasable = Decimal(allocation.quantity) - Decimal(allocation.released_quantity or 0)
            if releasable <= 0:
                continue
            take = min(releasable, remaining)
            value += take * Decimal(allocation.layer.unit_cost)
            remaining -= take
        return value.quantize(MONEY_QUANT)

    @staticmethod
    def _is_voided(sale: Sale) -> bool:
        """A sale is annulled when it carries void metadata, or is CANCELLED
        with void metadata. (A plain pre-existing CANCELLED from the legacy
        cancel path without voided_at is treated as a state conflict by the
        transition check, not as already-voided.)"""
        return sale.voided_at is not None
