from core.database import Base
import models  # noqa: F401


def test_inventory_ledger_schema_is_registered_in_metadata():
    expected_tables = {
        "reversal_operations",
        "purchase_receipts",
        "purchase_receipt_items",
        "inventory_layers",
        "inventory_allocations",
    }

    assert expected_tables.issubset(Base.metadata.tables)
    assert "inventory_value" in Base.metadata.tables["products"].columns
