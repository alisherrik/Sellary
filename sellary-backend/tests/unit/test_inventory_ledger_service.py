from decimal import Decimal

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
