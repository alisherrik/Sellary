"""Reports must close the day on the shop's clock, not the server's.

The server runs UTC and the shops run UTC+5, so a sale rung at 03:30 local was
stored as 22:30 UTC the previous day — and `func.date(created_at)` reported it
against that previous day. 12.5% of production sales fell in that window.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from core.security import get_password_hash
from models.sale import PaymentMethod, Sale, SaleStatus
from models.user import User
from services.company_time import local_day_bounds, to_local
from services.report_service import ReportService

DUSHANBE = ZoneInfo("Asia/Dushanbe")


@pytest.fixture
def cashier(db_session):
    user = User(
        username="tz-cashier",
        email="tz-cashier@test.com",
        hashed_password=get_password_hash("password"),
        role="cashier",
    )
    db_session.add(user)
    db_session.flush()
    return user


def make_sale(db_session, cashier, total, created_at):
    sale = Sale(
        cashier_id=cashier.id,
        subtotal=Decimal(total),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(total),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=created_at,
    )
    db_session.add(sale)
    db_session.flush()
    return sale


class TestCompanyClock:
    def test_company_defaults_to_the_shop_timezone(self, db_session, default_company):
        assert default_company.timezone == "Asia/Dushanbe"
        assert ReportService(db_session, default_company.id).tz() == DUSHANBE

    def test_day_bounds_are_aware_and_offset(self):
        start, end = local_day_bounds(DUSHANBE, datetime(2026, 7, 10).date())

        # Aware, so the DB compares absolute instants rather than reading these
        # as UTC midnight.
        assert start.utcoffset() == timedelta(hours=5)
        assert start.hour == 0 and end.hour == 23
        # Local midnight is 19:00 UTC the previous day — the whole point.
        assert start.astimezone(ZoneInfo("UTC")).hour == 19

    def test_stored_naive_timestamps_are_read_as_utc(self):
        # 22:30 UTC is 03:30 the NEXT day in Dushanbe.
        local = to_local(datetime(2026, 7, 10, 22, 30), DUSHANBE)

        assert local.date() == datetime(2026, 7, 11).date()
        assert local.hour == 3


class TestDailySalesBucketing:
    def test_late_evening_utc_sale_counts_on_the_next_local_day(self, db_session, cashier):
        """The exact reported case: a sale the report placed a day early."""
        make_sale(db_session, cashier, "50.00", datetime(2026, 7, 10, 22, 30))

        report = ReportService(db_session).get_daily_sales(
            datetime(2026, 7, 1), datetime(2026, 7, 20)
        )

        assert [(d.date, d.total_sales) for d in report.data] == [
            ("2026-07-11", Decimal("50.00"))
        ]

    def test_sales_either_side_of_local_midnight_split_into_two_days(self, db_session, cashier):
        # 18:00 UTC = 23:00 local on the 10th; 20:00 UTC = 01:00 local on the 11th.
        make_sale(db_session, cashier, "10.00", datetime(2026, 7, 10, 18, 0))
        make_sale(db_session, cashier, "20.00", datetime(2026, 7, 10, 20, 0))

        report = ReportService(db_session).get_daily_sales(
            datetime(2026, 7, 1), datetime(2026, 7, 20)
        )

        assert [(d.date, d.total_sales) for d in report.data] == [
            ("2026-07-10", Decimal("10.00")),
            ("2026-07-11", Decimal("20.00")),
        ]

    def test_daily_totals_still_sum_to_the_period_total(self, db_session, cashier):
        for hour in (2, 9, 18, 22):
            make_sale(db_session, cashier, "10.00", datetime(2026, 7, 10, hour, 0))

        report = ReportService(db_session).get_daily_sales(
            datetime(2026, 7, 1), datetime(2026, 7, 20)
        )

        assert sum(d.total_sales for d in report.data) == report.total_sales
        assert report.sales_count == 4
