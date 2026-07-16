"""Totals for the sales-history KPI cards.

Regression cover for the reported bug: the turnover card summed only the sales
the client had loaded (one 200-row page of a 528-sale history), so it under-
reported turnover until the operator clicked "show more" enough times.
"""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from core.security import get_password_hash
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_return import SaleReturn
from models.user import User
from services.sale_service import SaleService


@pytest.fixture
def cashier(db_session):
    user = User(
        username="summary-cashier",
        email="summary-cashier@test.com",
        hashed_password=get_password_hash("password"),
        role="cashier",
    )
    db_session.add(user)
    db_session.flush()
    return user


def make_sale(
    db_session,
    cashier,
    total,
    status=SaleStatus.COMPLETED,
    payment_method=PaymentMethod.CASH,
    created_at=None,
):
    sale = Sale(
        cashier_id=cashier.id,
        subtotal=Decimal(total),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(total),
        payment_method=payment_method,
        status=status,
        created_at=created_at or datetime(2026, 7, 10, 12, 0),
    )
    db_session.add(sale)
    db_session.flush()
    return sale


class TestSalesSummary:
    def test_totals_cover_every_sale_not_just_one_page(self, db_session, cashier):
        """The bug: 528 sales, a 200-row page, and a card that summed the page.

        The summary must not care how the client pages.
        """
        for _ in range(250):
            make_sale(db_session, cashier, "10.00")

        summary = SaleService(db_session).get_summary()

        assert summary.count == 250
        assert summary.turnover == Decimal("2500.00")

        # And it disagrees with what the old client-side sum would have produced.
        first_page, _ = SaleService(db_session).get_all(limit=200)
        page_sum = sum(Decimal(s.total_amount) for s in first_page)
        assert page_sum == Decimal("2000.00")
        assert summary.turnover > page_sum

    def test_cancelled_sales_are_not_turnover(self, db_session, cashier):
        make_sale(db_session, cashier, "100.00")
        make_sale(db_session, cashier, "40.00", status=SaleStatus.CANCELLED)

        summary = SaleService(db_session).get_summary()

        assert summary.turnover == Decimal("100.00")
        assert summary.count == 1

    def test_refunds_are_reported_and_subtracted_from_net(self, db_session, cashier):
        sale = make_sale(db_session, cashier, "100.00", status=SaleStatus.PARTIALLY_RETURNED)
        db_session.add(
            SaleReturn(
                company_id=sale.company_id,
                sale_id=sale.id,
                user_id=cashier.id,
                total_refund_amount=Decimal("30.00"),
                refund_method=PaymentMethod.CASH,
                created_at=datetime(2026, 7, 10, 13, 0),
            )
        )
        db_session.flush()

        summary = SaleService(db_session).get_summary()

        # Gross stays gross — the sale did happen — and net carries the refund.
        assert summary.turnover == Decimal("100.00")
        assert summary.refunds == Decimal("30.00")
        assert summary.net_turnover == Decimal("70.00")
        assert summary.refund_operations == 1

    def test_payment_method_filter_narrows_the_totals(self, db_session, cashier):
        make_sale(db_session, cashier, "100.00", payment_method=PaymentMethod.CASH)
        make_sale(db_session, cashier, "25.00", payment_method=PaymentMethod.CARD)

        service = SaleService(db_session)

        assert service.get_summary().turnover == Decimal("125.00")
        assert service.get_summary(
            payment_method=PaymentMethod.CARD
        ).turnover == Decimal("25.00")

    def test_average_check_ignores_cancelled_sales(self, db_session, cashier):
        make_sale(db_session, cashier, "100.00")
        make_sale(db_session, cashier, "50.00")
        make_sale(db_session, cashier, "999.00", status=SaleStatus.CANCELLED)

        summary = SaleService(db_session).get_summary()

        assert summary.average_check == Decimal("75.00")

    def test_empty_history_reports_zeroes_not_a_crash(self, db_session):
        summary = SaleService(db_session).get_summary()

        assert summary.count == 0
        assert summary.turnover == Decimal("0.00")
        assert summary.average_check == Decimal("0.00")
        assert summary.hourly == []

    def test_date_filter_applies_to_the_totals(self, db_session, cashier):
        make_sale(db_session, cashier, "100.00", created_at=datetime(2026, 7, 10, 12, 0))
        make_sale(db_session, cashier, "60.00", created_at=datetime(2026, 7, 1, 12, 0))

        summary = SaleService(db_session).get_summary(
            start_date=datetime(2026, 7, 5),
            end_date=datetime(2026, 7, 20),
        )

        assert summary.turnover == Decimal("100.00")
        assert summary.count == 1

    def test_hourly_buckets_use_the_company_clock(self, db_session, cashier):
        """22:30 UTC is 03:30 the next day in Asia/Dushanbe."""
        make_sale(db_session, cashier, "80.00", created_at=datetime(2026, 7, 10, 22, 30))

        summary = SaleService(db_session).get_summary()

        assert [(b.hour, b.turnover) for b in summary.hourly] == [(3, Decimal("80.00"))]

    def test_hourly_buckets_sum_to_turnover(self, db_session, cashier):
        for hour in (8, 8, 14, 21):
            make_sale(db_session, cashier, "10.00", created_at=datetime(2026, 7, 10, hour, 0))

        summary = SaleService(db_session).get_summary()

        assert sum(b.turnover for b in summary.hourly) == summary.turnover
