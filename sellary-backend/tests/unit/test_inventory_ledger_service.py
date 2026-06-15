from decimal import Decimal

import pytest
from sqlalchemy import inspect

from core.database import Base
from models import (
    InventoryAllocation,
    InventoryLayer,
    Product,
    PurchaseOrder,
    PurchaseReceipt,
    PurchaseReceiptItem,
    ReversalOperation,
    Sale,
    SaleItem,
)
from models.inventory_log import InventoryLog
from models.sale import PaymentMethod, SaleStatus
from services.inventory_ledger_service import InventoryLedgerService


def _index_columns(table):
    return {index.name: tuple(column.name for column in index.columns) for index in table.indexes}


def _foreign_key_targets(column):
    return {foreign_key.target_fullname for foreign_key in column.foreign_keys}


def test_inventory_ledger_tables_and_audit_columns_are_registered():
    expected_tables = {
        "reversal_operations",
        "purchase_receipts",
        "purchase_receipt_items",
        "inventory_layers",
        "inventory_allocations",
    }

    assert expected_tables.issubset(Base.metadata.tables)
    assert Product.__table__.c.inventory_value.default.arg == Decimal("0.0000")

    for model in (Sale, PurchaseOrder):
        assert {
            "voided_at",
            "voided_by_user_id",
            "void_reason",
            "reversal_operation_id",
        }.issubset(model.__table__.c.keys())

    assert Sale.__table__.c.voided_by_user_id.nullable is True
    assert _foreign_key_targets(Sale.__table__.c.voided_by_user_id) == {"users.id"}


def test_reversal_operation_column_contract():
    table = ReversalOperation.__table__

    assert table.c.id.index is not True
    assert table.c.entity_type.type.length == 40
    assert table.c.operation_type.type.length == 40
    assert table.c.reason.nullable is False
    assert table.c.impact.nullable is False
    assert table.c.impact.default.is_callable
    assert table.c.impact.default.arg.__name__ == "dict"


def test_purchase_receipt_indexes_and_relationship_contract():
    receipt_table = PurchaseReceipt.__table__
    item_table = PurchaseReceiptItem.__table__

    assert receipt_table.c.id.index is not True
    assert item_table.c.id.index is not True
    assert receipt_table.c.purchase_order_id.index is True
    assert item_table.c.product_id.index is True

    receipt_relationships = inspect(PurchaseReceipt).relationships
    assert set(receipt_relationships["items"].cascade) == {
        "delete",
        "delete-orphan",
        "expunge",
        "merge",
        "refresh-expire",
        "save-update",
    }
    assert "inventory_layer" in inspect(PurchaseReceiptItem).relationships
    assert "receipts" in inspect(PurchaseOrder).relationships


def test_inventory_layer_column_index_and_check_contract():
    table = InventoryLayer.__table__
    indexes = _index_columns(table)
    checks = {constraint.name for constraint in table.constraints if constraint.name}

    assert table.c.id.index is not True
    assert table.c.source_type.type.length == 40
    assert table.c.source_id.nullable is True
    assert table.c.company_id.index is True
    assert table.c.product_id.index is True
    assert table.c.purchase_receipt_item_id.unique is True
    assert table.c.purchase_receipt_item_id.index is True
    assert indexes["ix_inventory_layers_fifo"] == (
        "company_id",
        "product_id",
        "created_at",
        "id",
    )
    assert {
        "ck_inventory_layers_original_nonnegative",
        "ck_inventory_layers_remaining_nonnegative",
        "ck_inventory_layers_remaining_lte_original",
    }.issubset(checks)


def test_inventory_allocation_column_index_and_relationship_contract():
    table = InventoryAllocation.__table__
    indexes = _index_columns(table)
    checks = {constraint.name for constraint in table.constraints if constraint.name}

    assert table.c.id.index is not True
    assert table.c.consumer_type.type.length == 40
    for column_name in ("company_id", "product_id", "layer_id", "sale_item_id"):
        assert table.c[column_name].index is True
    assert "ix_inventory_allocations_consumer" not in indexes
    assert {
        "ck_inventory_allocations_quantity_positive",
        "ck_inventory_allocations_released_nonnegative",
        "ck_inventory_allocations_released_lte_quantity",
    }.issubset(checks)
    assert "allocations" in inspect(SaleItem).relationships


# ---------------------------------------------------------------------------
# Ledger service fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ledger_product(db_session, default_company) -> Product:
    """A bare product with zero stock/value so the ledger owns all arithmetic."""
    product = Product(
        company_id=default_company.id,
        name="Ledger Widget",
        barcode="LEDGER-001",
        cost_price=Decimal("0.00"),
        sell_price=Decimal("25.00"),
        stock_quantity=Decimal("0"),
        inventory_value=Decimal("0.0000"),
        min_stock_level=Decimal("5"),
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    return product


@pytest.fixture
def allocated_sale_item(db_session, default_company, ledger_product, admin_user) -> SaleItem:
    """A sale item that has consumed 5 units across two FIFO layers (3 + 2)."""
    service = InventoryLedgerService(db_session, ledger_product.company_id)
    service.add_layer(ledger_product, Decimal("3"), Decimal("10"), "opening_balance", None, admin_user.id)
    service.add_layer(ledger_product, Decimal("4"), Decimal("20"), "purchase_receipt_item", 11, admin_user.id)

    sale = Sale(
        company_id=default_company.id,
        cashier_id=admin_user.id,
        subtotal=Decimal("125.00"),
        tax_amount=Decimal("0.00"),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal("125.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
    )
    db_session.add(sale)
    db_session.flush()

    sale_item = SaleItem(
        sale_id=sale.id,
        product_id=ledger_product.id,
        quantity=Decimal("5"),
        unit_price=Decimal("25.00"),
        subtotal=Decimal("125.00"),
        total=Decimal("125.00"),
    )
    db_session.add(sale_item)
    db_session.flush()

    service.consume_fifo(
        product=ledger_product,
        quantity=Decimal("5"),
        consumer_type="sale_item",
        consumer_id=sale_item.id,
        sale_item_id=sale_item.id,
        user_id=admin_user.id,
        reason=f"Sale #{sale.id}",
        reference_type="sale",
        reference_id=sale.id,
    )
    db_session.flush()
    db_session.refresh(sale_item)
    return sale_item


# ---------------------------------------------------------------------------
# Ledger service behaviour
# ---------------------------------------------------------------------------


def test_add_layer_increases_stock_value_and_recomputes_cost(db_session, ledger_product, admin_user):
    service = InventoryLedgerService(db_session, ledger_product.company_id)

    product = service.add_layer(
        ledger_product, Decimal("5"), Decimal("10"), "opening_balance", None, admin_user.id
    )

    assert product.stock_quantity == Decimal("5")
    assert product.inventory_value == Decimal("50.0000")
    assert product.cost_price == Decimal("10.00")

    layers = (
        db_session.query(InventoryLayer)
        .filter(InventoryLayer.product_id == ledger_product.id)
        .all()
    )
    assert len(layers) == 1
    assert layers[0].original_quantity == Decimal("5")
    assert layers[0].remaining_quantity == Decimal("5")

    logs = (
        db_session.query(InventoryLog)
        .filter(InventoryLog.product_id == ledger_product.id)
        .all()
    )
    assert len(logs) == 1
    assert logs[0].quantity_change == Decimal("5")
    assert logs[0].value_change == Decimal("50.0000")


def test_consume_fifo_updates_layers_stock_and_value(db_session, ledger_product, admin_user):
    service = InventoryLedgerService(db_session, ledger_product.company_id)
    service.add_layer(ledger_product, Decimal("5"), Decimal("10"), "opening_balance", None, admin_user.id)
    service.add_layer(ledger_product, Decimal("5"), Decimal("20"), "purchase_receipt_item", 11, admin_user.id)

    consumption = service.consume_fifo(
        product=ledger_product,
        quantity=Decimal("7"),
        consumer_type="sale_item",
        consumer_id=41,
        sale_item_id=41,
        user_id=admin_user.id,
        reason="Sale #9",
        reference_type="sale",
        reference_id=9,
    )

    assert [a.quantity for a in consumption.allocations] == [Decimal("5"), Decimal("2")]
    assert consumption.value == Decimal("90.0000")
    assert ledger_product.stock_quantity == Decimal("3")
    assert ledger_product.inventory_value == Decimal("60.0000")
    # Remaining 3 units all come from the 20-cost layer.
    assert ledger_product.cost_price == Decimal("20.00")


def test_consume_fifo_raises_when_layers_insufficient(db_session, ledger_product, admin_user):
    service = InventoryLedgerService(db_session, ledger_product.company_id)
    service.add_layer(ledger_product, Decimal("4"), Decimal("10"), "opening_balance", None, admin_user.id)

    with pytest.raises(ValueError, match="Insufficient stock"):
        service.consume_fifo(
            product=ledger_product,
            quantity=Decimal("5"),
            consumer_type="sale_item",
            consumer_id=1,
            sale_item_id=1,
            user_id=admin_user.id,
            reason="Sale #1",
            reference_type="sale",
            reference_id=1,
        )


def test_consume_all_stock_zeroes_value_and_keeps_cost_price(db_session, ledger_product, admin_user):
    service = InventoryLedgerService(db_session, ledger_product.company_id)
    service.add_layer(ledger_product, Decimal("5"), Decimal("10"), "opening_balance", None, admin_user.id)
    cost_before = ledger_product.cost_price

    service.consume_fifo(
        product=ledger_product,
        quantity=Decimal("5"),
        consumer_type="sale_item",
        consumer_id=2,
        sale_item_id=2,
        user_id=admin_user.id,
        reason="Sale #2",
        reference_type="sale",
        reference_id=2,
    )

    assert ledger_product.stock_quantity == Decimal("0")
    assert ledger_product.inventory_value == Decimal("0.0000")
    # cost_price is left untouched (no divide-by-zero) when stock hits zero.
    assert ledger_product.cost_price == cost_before


def test_release_allocations_restores_original_layers(db_session, allocated_sale_item, admin_user):
    service = InventoryLedgerService(db_session, allocated_sale_item.sale.company_id)
    service.release_sale_item(
        allocated_sale_item,
        Decimal("3"),
        user_id=admin_user.id,
        reason="Аннулирование продажи",
        reference_type="sale_void",
        reference_id=allocated_sale_item.sale_id,
    )
    assert sum(a.released_quantity for a in allocated_sale_item.allocations) == Decimal("3")


def test_release_restores_stock_value_in_reverse_layer_order(db_session, allocated_sale_item, admin_user):
    product = allocated_sale_item.product
    # After the fixture: consumed 5 (3 @10 + 2 @20). Stock 2 left @20, value 40.0000.
    assert product.stock_quantity == Decimal("2")
    assert product.inventory_value == Decimal("40.0000")

    service = InventoryLedgerService(db_session, allocated_sale_item.sale.company_id)
    service.release_sale_item(
        allocated_sale_item,
        Decimal("3"),
        user_id=admin_user.id,
        reason="Возврат",
        reference_type="sale_void",
        reference_id=allocated_sale_item.sale_id,
    )

    # Reverse order releases the 2 @20 first, then 1 @10 -> restored value 2*20 + 1*10 = 50.
    assert product.stock_quantity == Decimal("5")
    assert product.inventory_value == Decimal("90.0000")
    assert sum(a.released_quantity for a in allocated_sale_item.allocations) == Decimal("3")

    # Source layers' remaining_quantity is restored consistently. Release walks
    # allocations in reverse: the 20-cost layer (consumed 2) is refilled first
    # (2 -> 4), then 1 unit returns to the 10-cost layer (0 -> 1).
    layers = {
        layer.unit_cost: layer
        for layer in db_session.query(InventoryLayer)
        .filter(InventoryLayer.product_id == product.id)
        .all()
    }
    assert layers[Decimal("20.00")].remaining_quantity == Decimal("4")
    assert layers[Decimal("10.00")].remaining_quantity == Decimal("1")
