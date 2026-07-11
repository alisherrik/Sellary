"""Unit tests for oversell-tolerant FIFO consumption (C1)."""
from decimal import Decimal

import pytest

from services.inventory_ledger_service import InventoryLedgerService


def test_consume_fifo_strict_by_default_raises_on_oversell(
    db_session, layered_product, admin_user
):
    # layered_product holds 5 units (2 @ 10, then 3 @ 20).
    ledger = InventoryLedgerService(db_session, layered_product.company_id)
    with pytest.raises(ValueError, match="Insufficient stock"):
        ledger.consume_fifo(
            product=layered_product,
            quantity=Decimal("8"),
            consumer_type="sale_item",
            consumer_id=1,
            sale_item_id=None,
            user_id=admin_user.id,
            reason="oversell attempt",
            reference_type="sale",
            reference_id=1,
        )


def test_consume_fifo_allow_oversell_goes_negative_and_reports_shortfall(
    db_session, layered_product, admin_user
):
    ledger = InventoryLedgerService(db_session, layered_product.company_id)
    # Baseline: stock 5, inventory_value 80 -> cost_price 16.
    assert layered_product.stock_quantity == Decimal("5")
    assert layered_product.cost_price == Decimal("16.0000")

    consumption = ledger.consume_fifo(
        product=layered_product,
        quantity=Decimal("8"),
        consumer_type="sale_item",
        consumer_id=1,
        sale_item_id=None,
        user_id=admin_user.id,
        reason="oversell",
        reference_type="sale",
        reference_id=1,
        allow_oversell=True,
    )

    # 5 real units (value 80) + 3 shortfall @ cost_price 16 (value 48) = 128.
    assert consumption.value == Decimal("128.0000")
    assert consumption.shortfall_quantity == Decimal("3")
    assert consumption.available_before == Decimal("5")
    # Stock goes negative; inventory_value clamped to 0; cost_price frozen.
    assert layered_product.stock_quantity == Decimal("-3")
    assert layered_product.inventory_value == Decimal("0.0000")
    assert layered_product.cost_price == Decimal("16.0000")
