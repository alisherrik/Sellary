"""A refund must pay back exactly what the line charged — to the cent."""

from decimal import Decimal

from services.sale_return_service import SaleReturnService


class _Item:
    """Minimal stand-in: the helper only reads refund_amount off past returns."""

    def __init__(self, refunds):
        self.return_items = [type("R", (), {"refund_amount": r})() for r in refunds]


class TestRefundRounding:
    def test_already_refunded_sums_previous_partial_returns(self):
        assert SaleReturnService._already_refunded(_Item(["33.33", "33.33"])) == Decimal("66.66")

    def test_already_refunded_is_zero_for_an_untouched_line(self):
        assert SaleReturnService._already_refunded(_Item([])) == Decimal("0.00")

    def test_a_third_of_a_hundred_settles_exactly_on_the_last_return(self):
        # 100.00 / 3 = 33.333…; three quantized refunds sum to 99.99 and leave
        # the customer a cent short. The final return takes the remainder.
        line_total = Decimal("100.00")
        first = Decimal("33.33")
        second = Decimal("33.33")
        item = _Item([str(first), str(second)])
        final = line_total - SaleReturnService._already_refunded(item)
        assert final == Decimal("33.34")
        assert first + second + final == line_total
