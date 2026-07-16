"""Till-shift totals: what the drawer should hold, split by payment method.

Cashiers share one account, so `cashier_id` can't tell one shift from the next.
A shift is a time window; every sale, refund and debt repayment in it counts by
its own timestamp. Only CASH movements touch the drawer.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from core.security import get_password_hash
from models.cash_shift import CashShiftStatus
from models.customer import Customer
from models.customer_ledger_entry import CustomerLedgerEntry
from models.sale import CardType, PaymentMethod, Sale, SaleStatus
from models.sale_return import SaleReturn
from models.user import User
from services.cash_shift_service import CashShiftService, ShiftConflict

T0 = datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)


@pytest.fixture
def cashier(db_session):
    u = User(
        username="shift-cashier",
        email="shift-cashier@test.com",
        hashed_password=get_password_hash("password"),
        role="cashier",
    )
    db_session.add(u)
    db_session.flush()
    return u


def sale(db_session, cashier, total, method=PaymentMethod.CASH, card=None,
         status=SaleStatus.COMPLETED, at=T0):
    s = Sale(
        cashier_id=cashier.id,
        subtotal=Decimal(total),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(total),
        payment_method=method,
        card_type=card,
        status=status,
        created_at=at,
    )
    db_session.add(s)
    db_session.flush()
    return s


def debt_payment(db_session, cashier, amount, method="cash", at=T0):
    # Repayments are stored as a negative ledger amount.
    cust = Customer(name="c")
    db_session.add(cust)
    db_session.flush()
    e = CustomerLedgerEntry(
        company_id=cust.company_id,
        customer_id=cust.id,
        entry_type="payment",
        amount=Decimal(amount) * Decimal("-1"),
        payment_method=method,
        created_by_user_id=cashier.id,
        created_at=at,
    )
    db_session.add(e)
    db_session.flush()
    return e


def refund(db_session, cashier, base_sale, amount, method=PaymentMethod.CASH, at=T0):
    r = SaleReturn(
        company_id=base_sale.company_id,
        sale_id=base_sale.id,
        user_id=cashier.id,
        total_refund_amount=Decimal(amount),
        refund_method=method,
        created_at=at,
    )
    db_session.add(r)
    db_session.flush()
    return r


class TestExpectedCash:
    def test_cash_sales_add_to_the_drawer(self, db_session, cashier):
        sale(db_session, cashier, "100.00")
        sale(db_session, cashier, "40.00")
        totals = CashShiftService(db_session).compute_totals(T0, None, Decimal("50.00"))
        # opening 50 + 140 cash sales.
        assert totals.cash_sales == Decimal("140.00")
        assert totals.expected_cash == Decimal("190.00")

    def test_card_and_credit_do_not_touch_the_drawer(self, db_session, cashier):
        sale(db_session, cashier, "100.00")  # cash
        sale(db_session, cashier, "60.00", method=PaymentMethod.CARD, card=CardType.DC)
        sale(db_session, cashier, "30.00", method=PaymentMethod.CREDIT)
        totals = CashShiftService(db_session).compute_totals(T0, None, Decimal("0.00"))
        assert totals.card_sales == Decimal("60.00")
        assert totals.card_by_type == {"dc": Decimal("60.00")}
        assert totals.credit_sales == Decimal("30.00")
        # Only the 100 cash sale reaches the till.
        assert totals.expected_cash == Decimal("100.00")

    def test_cash_debt_repayment_adds_to_the_drawer(self, db_session, cashier):
        debt_payment(db_session, cashier, "80.00", method="cash")
        debt_payment(db_session, cashier, "20.00", method="card")  # not cash → no drawer
        totals = CashShiftService(db_session).compute_totals(T0, None, Decimal("0.00"))
        assert totals.debt_payments_by_method["cash"] == Decimal("80.00")
        assert totals.expected_cash == Decimal("80.00")

    def test_cash_refund_leaves_the_drawer(self, db_session, cashier):
        s = sale(db_session, cashier, "100.00")
        refund(db_session, cashier, s, "30.00", method=PaymentMethod.CASH)
        totals = CashShiftService(db_session).compute_totals(T0, None, Decimal("10.00"))
        # 10 opening + 100 cash sale − 30 cash refund.
        assert totals.refunds_by_method["cash"] == Decimal("30.00")
        assert totals.expected_cash == Decimal("80.00")

    def test_cancelled_sales_are_ignored(self, db_session, cashier):
        sale(db_session, cashier, "100.00")
        sale(db_session, cashier, "999.00", status=SaleStatus.CANCELLED)
        totals = CashShiftService(db_session).compute_totals(T0, None, Decimal("0.00"))
        assert totals.expected_cash == Decimal("100.00")
        assert totals.sales_count == 1

    def test_only_movements_inside_the_window_count(self, db_session, cashier):
        sale(db_session, cashier, "100.00", at=T0 + timedelta(hours=1))
        sale(db_session, cashier, "500.00", at=T0 - timedelta(hours=1))  # before open
        sale(db_session, cashier, "700.00", at=T0 + timedelta(hours=5))  # after close
        totals = CashShiftService(db_session).compute_totals(
            T0, T0 + timedelta(hours=2), Decimal("0.00")
        )
        assert totals.expected_cash == Decimal("100.00")

    def test_empty_window_is_just_the_opening_float(self, db_session, cashier):
        totals = CashShiftService(db_session).compute_totals(T0, None, Decimal("250.00"))
        assert totals.expected_cash == Decimal("250.00")
        assert totals.sales_count == 0


class TestOpenCloseSnapshot:
    def test_open_then_second_open_conflicts(self, db_session, cashier):
        svc = CashShiftService(db_session)
        svc.open_shift(Decimal("100.00"), cashier.id)
        with pytest.raises(ShiftConflict):
            svc.open_shift(Decimal("0.00"), cashier.id)

    def test_shift_numbers_increment_per_company(self, db_session, cashier):
        svc = CashShiftService(db_session)
        first = svc.open_shift(Decimal("0.00"), cashier.id)
        svc.close_shift(first.id, Decimal("0.00"), None, cashier.id)
        second = svc.open_shift(Decimal("0.00"), cashier.id)
        assert (first.shift_number, second.shift_number) == (1, 2)

    def test_close_records_discrepancy(self, db_session, cashier):
        svc = CashShiftService(db_session)
        shift = svc.open_shift(Decimal("50.00"), cashier.id)
        sale(db_session, cashier, "100.00", at=shift.opened_at + timedelta(minutes=5))
        # Expected 150; cashier counts 145 → 5 short.
        closed = svc.close_shift(shift.id, Decimal("145.00"), None, cashier.id)
        assert closed.expected_cash == Decimal("150.00")
        assert closed.discrepancy == Decimal("-5.00")
        assert closed.status == CashShiftStatus.CLOSED

    def test_reclosing_conflicts(self, db_session, cashier):
        svc = CashShiftService(db_session)
        shift = svc.open_shift(Decimal("0.00"), cashier.id)
        svc.close_shift(shift.id, Decimal("0.00"), None, cashier.id)
        with pytest.raises(ShiftConflict):
            svc.close_shift(shift.id, Decimal("0.00"), None, cashier.id)

    def test_closed_totals_are_frozen(self, db_session, cashier):
        svc = CashShiftService(db_session)
        shift = svc.open_shift(Decimal("0.00"), cashier.id)
        sale(db_session, cashier, "100.00", at=shift.opened_at + timedelta(minutes=1))
        closed = svc.close_shift(shift.id, Decimal("100.00"), None, cashier.id)
        frozen = svc.totals_for(closed)
        # A sale arriving AFTER the close must not move the frozen number.
        sale(db_session, cashier, "500.00", at=closed.closed_at + timedelta(minutes=1))
        again = svc.totals_for(closed)
        assert frozen.expected_cash == again.expected_cash == Decimal("100.00")

    def test_snapshot_does_not_close_the_shift(self, db_session, cashier):
        svc = CashShiftService(db_session)
        shift = svc.open_shift(Decimal("0.00"), cashier.id)
        svc.take_snapshot(shift.id, cashier.id)
        assert svc.get_current() is not None
        assert shift.status == CashShiftStatus.OPEN
