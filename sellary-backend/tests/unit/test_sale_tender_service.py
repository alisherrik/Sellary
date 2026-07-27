"""Composing the tenders for a sale.

Pure arithmetic and rules, so everything that can go wrong with a split payment
is checked here rather than through a sale. The rule that matters most is that
the tenders sum to the total exactly — a payment screen that lets a cashier
walk away 3 short is worse than one that refuses.
"""

from dataclasses import dataclass
from decimal import Decimal

import pytest

from models.sale import CardType, PaymentMethod
from services.sale_tender_service import (
    compose_tenders,
    credit_amount,
    dominant_method,
    tenders_from_scalars,
)


@dataclass
class FakeLine:
    method: str
    amount: str
    card_type: str | None = None


@dataclass
class FakeRequest:
    """Stands in for SaleCreate — only the payment fields are read."""

    payments: list | None = None
    payment_method: str | None = None
    card_type: str | None = None
    paid_amount: str = "0.00"
    initial_payment_method: str | None = None
    customer_id: int | None = None


def _compose(total, **kwargs):
    return compose_tenders(FakeRequest(**kwargs), Decimal(total))


class TestTheWorkedExample:
    """50 сомони: 26 наличными, 10 DC, 10 Эсхата, 4 в долг."""

    def _sale(self):
        return _compose(
            "50.00",
            customer_id=7,
            payments=[
                FakeLine("cash", "26.00"),
                FakeLine("card", "10.00", "dc"),
                FakeLine("card", "10.00", "eskhata"),
                FakeLine("credit", "4.00"),
            ],
        )

    def test_all_four_tenders_are_kept(self):
        tenders = self._sale()
        assert [(t.method.value, t.card_type.value if t.card_type else None, str(t.amount))
                for t in tenders] == [
            ("cash", None, "26.00"),
            ("card", "dc", "10.00"),
            ("card", "eskhata", "10.00"),
            ("credit", None, "4.00"),
        ]

    def test_the_two_cards_stay_apart(self):
        """DC and Эсхата are different banks; merging them loses which is owed."""
        cards = [t for t in self._sale() if t.method == PaymentMethod.CARD]
        assert {t.card_type for t in cards} == {CardType.DC, CardType.ESKHATA}

    def test_the_debt_is_four_not_fifty(self):
        assert credit_amount(self._sale()) == Decimal("4.00")

    def test_the_sale_files_itself_under_cash(self):
        """26 is the biggest tender, so that is what the legacy column says."""
        method, card = dominant_method(self._sale())
        assert method == PaymentMethod.CASH
        assert card is None


class TestSumMustMatch:
    def test_short_payment_is_refused_and_says_by_how_much(self):
        with pytest.raises(ValueError) as exc:
            _compose(
                "50.00",
                customer_id=7,
                payments=[
                    FakeLine("cash", "26.00"),
                    FakeLine("card", "10.00", "dc"),
                    FakeLine("card", "10.00", "eskhata"),
                    FakeLine("credit", "3.00"),
                ],
            )
        assert "1.00 short" in str(exc.value)
        assert "49.00 tendered of 50.00" in str(exc.value)

    def test_overpayment_is_refused_rather_than_rounded(self):
        with pytest.raises(ValueError) as exc:
            _compose(
                "50.00",
                payments=[FakeLine("cash", "60.00")],
            )
        assert "exceed the sale total by 10.00" in str(exc.value)

    def test_a_single_cent_out_still_fails(self):
        with pytest.raises(ValueError):
            _compose("50.00", payments=[FakeLine("cash", "49.99")])


class TestRules:
    def test_two_credit_lines_are_refused(self):
        with pytest.raises(ValueError, match="at most one credit"):
            _compose(
                "50.00",
                customer_id=7,
                payments=[FakeLine("credit", "25.00"), FakeLine("credit", "25.00")],
            )

    def test_credit_without_a_customer_is_refused(self):
        with pytest.raises(ValueError, match="Customer is required"):
            _compose(
                "50.00",
                payments=[FakeLine("cash", "46.00"), FakeLine("credit", "4.00")],
            )

    def test_a_card_line_needs_its_bank(self):
        with pytest.raises(ValueError, match="card_type is required"):
            _compose("50.00", payments=[FakeLine("card", "50.00")])

    def test_a_bank_on_a_cash_line_is_refused(self):
        with pytest.raises(ValueError, match="must not be set"):
            _compose("50.00", payments=[FakeLine("cash", "50.00", "dc")])

    def test_the_same_tender_twice_is_merged(self):
        tenders = _compose(
            "50.00",
            payments=[FakeLine("cash", "20.00"), FakeLine("cash", "30.00")],
        )
        assert len(tenders) == 1
        assert tenders[0].amount == Decimal("50.00")

    def test_the_same_card_twice_is_merged_but_two_banks_are_not(self):
        tenders = _compose(
            "50.00",
            payments=[
                FakeLine("card", "20.00", "dc"),
                FakeLine("card", "10.00", "dc"),
                FakeLine("card", "20.00", "eskhata"),
            ],
        )
        assert len(tenders) == 2
        assert tenders[0].amount == Decimal("30.00")


class TestDominantMethod:
    def test_the_largest_tender_wins(self):
        method, _ = dominant_method(
            _compose(
                "50.00",
                customer_id=7,
                payments=[FakeLine("card", "30.00", "dc"), FakeLine("credit", "20.00")],
            )
        )
        assert method == PaymentMethod.CARD

    def test_a_tie_is_broken_towards_cash(self):
        """Arbitrary but fixed, so the same sale always files the same way."""
        method, _ = dominant_method(
            _compose(
                "50.00",
                payments=[FakeLine("card", "25.00", "dc"), FakeLine("cash", "25.00")],
            )
        )
        assert method == PaymentMethod.CASH


class TestTheOlderShape:
    """The offline cashier still sends one method and an optional prepayment."""

    def test_a_plain_cash_sale_becomes_one_tender(self):
        tenders = _compose("50.00", payment_method="cash")
        assert len(tenders) == 1
        assert tenders[0].method == PaymentMethod.CASH
        assert tenders[0].amount == Decimal("50.00")

    def test_a_card_sale_keeps_its_bank(self):
        tenders = _compose("50.00", payment_method="card", card_type="eskhata")
        assert tenders[0].card_type == CardType.ESKHATA

    def test_a_credit_sale_with_a_prepayment_becomes_two_tenders(self):
        tenders = _compose(
            "50.00",
            customer_id=7,
            payment_method="credit",
            paid_amount="20.00",
            initial_payment_method="cash",
        )
        assert [(t.method.value, str(t.amount)) for t in tenders] == [
            ("cash", "20.00"),
            ("credit", "30.00"),
        ]

    def test_a_fully_prepaid_credit_sale_leaves_no_debt(self):
        tenders = _compose(
            "50.00",
            customer_id=7,
            payment_method="credit",
            paid_amount="50.00",
            initial_payment_method="cash",
        )
        assert credit_amount(tenders) == Decimal("0.00")

    def test_scalars_reach_the_same_place_from_primitives(self):
        """The sync endpoint calls this directly; it must agree with the above."""
        tenders = tenders_from_scalars(
            method="credit",
            card_type=None,
            total=Decimal("50.00"),
            paid_amount=Decimal("20.00"),
            initial_method="cash",
        )
        assert [(t.method.value, str(t.amount)) for t in tenders] == [
            ("cash", "20.00"),
            ("credit", "30.00"),
        ]
