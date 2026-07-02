"""Regression tests for decimal product stock response fields."""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from models.product import Product
from schemas.product import ProductUpdate
from schemas.report import LowStockItem


def test_product_update_rejects_explicit_null_min_stock_level():
    """An empty editor value must not reach ProductResponse as database NULL."""

    with pytest.raises(ValidationError):
        ProductUpdate(min_stock_level=None)


def test_low_stock_item_preserves_fractional_quantities():
    """Weighted products use NUMERIC(10,3), including dashboard stock values."""

    item = LowStockItem(
        product_id=1,
        product_name="Weighted product",
        barcode="WEIGHT-1",
        current_stock=Decimal("0.430"),
        min_stock_level=Decimal("0.500"),
    )

    assert item.current_stock == Decimal("0.430")
    assert item.min_stock_level == Decimal("0.500")


def test_min_stock_level_database_column_is_non_nullable_with_default():
    column = Product.__table__.c.min_stock_level

    assert column.nullable is False
    assert str(column.server_default.arg) == "5.000"
