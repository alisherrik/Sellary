"""Regression tests: a received purchase must stay voidable after the products
it stocked were deleted/recreated, and product deletion must never leave a
'ghost' layer (orphaned units with no matching product balance).

Root cause these guard against:
- Product deletion writes off remaining stock FIFO, creating ``product_delete``
  allocations against the purchase's layers. ``preview_purchase`` used to treat
  those internal write-offs as hard ``inventory_adjustment`` blockers, so the
  purchase could never be voided through the app (a dead end — you cannot
  "reverse a deletion" from the UI).
- The delete fallback zeroed the product balance without consuming the layers,
  orphaning layer units (the ``ghost`` drift) that later drove a purchase void
  into a negative balance.
"""
from decimal import Decimal

from models.inventory_layer import InventoryAllocation, InventoryLayer
from models.product import Product
from services.inventory_ledger_service import InventoryLedgerService
from services.product_service import ProductService
from services.transaction_reversal_service import TransactionReversalService


def test_void_purchase_after_product_delete_succeeds_and_releases_writeoff(
    db_session, partially_received_po, admin_user
):
    """Deleting a received product must not permanently trap its purchase.

    The void should auto-release the ``product_delete`` allocation, reverse the
    purchase layer, and keep the product balance non-negative.
    """
    po = partially_received_po
    company_id = po.company_id
    receipt_item = po.receipts[0].items[0]
    po_layer = receipt_item.inventory_layer
    product = receipt_item.product

    assert ProductService(db_session, company_id).delete(product.id, admin_user.id) is True
    db_session.flush()

    writeoff = (
        db_session.query(InventoryAllocation)
        .filter(
            InventoryAllocation.layer_id == po_layer.id,
            InventoryAllocation.consumer_type == "product_delete",
        )
        .one()
    )
    assert Decimal(writeoff.released_quantity) == Decimal("0")

    service = TransactionReversalService(db_session, company_id)
    preview = service.preview_purchase(po.id)
    assert preview.can_void is True
    assert preview.blockers == []

    result = service.void_purchase(
        po.id, "Аннулирование после удаления товара", admin_user.id
    )
    assert result.status == "cancelled"

    db_session.refresh(po_layer)
    db_session.refresh(writeoff)
    db_session.refresh(product)
    assert po_layer.reversed_at is not None
    assert Decimal(po_layer.remaining_quantity) == Decimal("0")
    assert Decimal(writeoff.released_quantity) == Decimal(writeoff.quantity)
    assert Decimal(product.stock_quantity) >= Decimal("0")


def test_purchase_preview_still_blocks_on_manual_adjustment(
    db_session, partially_received_po
):
    """A genuine manual stock adjustment must STILL block the void — the fix for
    product_delete write-offs must not loosen protection against real edits."""
    receipt_item = partially_received_po.receipts[0].items[0]
    layer = receipt_item.inventory_layer
    layer.remaining_quantity = Decimal(layer.remaining_quantity) - Decimal("1")
    db_session.add(
        InventoryAllocation(
            company_id=partially_received_po.company_id,
            product_id=receipt_item.product_id,
            layer_id=layer.id,
            consumer_type="manual_adjustment",
            consumer_id=999,
            sale_item_id=None,
            quantity=Decimal("1"),
            released_quantity=Decimal("0"),
        )
    )
    db_session.flush()

    preview = TransactionReversalService(
        db_session, partially_received_po.company_id
    ).preview_purchase(partially_received_po.id)
    assert preview.can_void is False
    assert preview.blockers[0].blocker_type == "inventory_adjustment"


def test_void_purchase_reverses_reconciled_ghost_layer(
    db_session, partially_received_po, admin_user
):
    """A purchase layer whose product balance drifted to zero (a 'ghost') becomes
    voidable once the balance is reconciled to match the layer: the void reverses
    the layer and the product lands at zero without ever going negative. This is
    the mechanism the production #15 repair relies on for product 252."""
    po = partially_received_po
    company_id = po.company_id
    layer = po.receipts[0].items[0].inventory_layer
    product = po.receipts[0].items[0].product
    ledger = InventoryLedgerService(db_session, company_id)

    # Force the ghost: drop the product balance to zero while the layer keeps its
    # received units (exactly the shape the buggy delete fallback used to leave).
    ghost_units = Decimal(layer.remaining_quantity)
    product.stock_quantity = Decimal("0")
    product.inventory_value = Decimal("0.0000")
    db_session.flush()

    # Reconcile: restore the layer's units to the balance before voiding.
    value = (ghost_units * Decimal(layer.unit_cost)).quantize(Decimal("0.0001"))
    ledger._apply_balance(product, ghost_units, value)
    db_session.flush()

    service = TransactionReversalService(db_session, company_id)
    preview = service.preview_purchase(po.id)
    assert preview.can_void is True
    assert preview.blockers == []

    result = service.void_purchase(po.id, "Void after ghost reconcile", admin_user.id)
    assert result.status == "cancelled"

    db_session.refresh(layer)
    db_session.refresh(product)
    assert layer.reversed_at is not None
    assert Decimal(layer.remaining_quantity) == Decimal("0")
    assert Decimal(product.stock_quantity) == Decimal("0")
    assert Decimal(product.inventory_value) >= Decimal("0")


def test_delete_with_balance_drift_leaves_no_ghost_layer(
    db_session, default_company, test_category, admin_user
):
    """Deleting a product whose balance drifted above its layers must drain the
    layers to zero — never leave orphaned ('ghost') units behind."""
    product = Product(
        company_id=default_company.id,
        name="Drift Delete Product",
        barcode="DRIFTDEL1",
        category_id=test_category.id,
        cost_price=Decimal("10.0000"),
        sell_price=Decimal("15.00"),
        stock_quantity=Decimal("0"),
        inventory_value=Decimal("0.0000"),
        min_stock_level=Decimal("0"),
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()

    ledger = InventoryLedgerService(db_session, default_company.id)
    ledger.add_layer(
        product, Decimal("6"), Decimal("10.0000"), "opening_balance", None, admin_user.id
    )
    db_session.flush()

    # Simulate pre-existing drift: the balance claims more than the layers hold.
    product.stock_quantity = Decimal("10")
    db_session.flush()

    assert ProductService(db_session, default_company.id).delete(product.id, admin_user.id) is True
    db_session.flush()
    db_session.refresh(product)

    assert product.is_active is False
    assert Decimal(product.stock_quantity) == Decimal("0")
    layers = (
        db_session.query(InventoryLayer)
        .filter(InventoryLayer.product_id == product.id)
        .all()
    )
    assert layers
    assert all(Decimal(layer.remaining_quantity) == Decimal("0") for layer in layers)
