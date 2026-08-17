"""What the Инвентаризация page is allowed to call a count."""
from schemas.inventory_log import STOCKTAKE_REFERENCE_TYPES, StocktakeReason


def test_every_stocktake_reason_is_included():
    """Adding a reason to the enum must not silently drop it from the page."""
    for reason in StocktakeReason:
        assert reason.value in STOCKTAKE_REFERENCE_TYPES


def test_the_removed_edit_form_channel_is_included():
    """146 of these reached production; hiding them makes the audit a lie."""
    assert "manual_adjust" in STOCKTAKE_REFERENCE_TYPES


def test_ordinary_movements_are_excluded():
    for reference_type in ("sale", "po_receive", "write_off", "product_initial"):
        assert reference_type not in STOCKTAKE_REFERENCE_TYPES
