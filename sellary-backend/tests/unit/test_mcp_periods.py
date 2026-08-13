"""Named periods must land on the company's day, not the server's.

The whole reason tools take `period="last_month"` instead of a date pair is
that date arithmetic fails quietly — a report for the wrong month looks exactly
as plausible as one for the right month.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastmcp.exceptions import ToolError

from mcp_server.periods import PERIODS, resolve_days, resolve_period
from services.company_time import local_day_bounds


class FakeService:
    """Stands in for ReportService: `tz`, `local_day_bounds` and `open_from`."""

    def __init__(self, tz_name: str = "Asia/Dushanbe", open_from: date | None = None):
        self._tz = ZoneInfo(tz_name)
        self._open_from = open_from

    def tz(self) -> ZoneInfo:
        return self._tz

    def local_day_bounds(self, day=None):
        return local_day_bounds(self._tz, day)

    def open_from(self):
        return self._open_from


class TestResolveDays:
    def test_today_and_yesterday(self):
        today = date(2026, 7, 27)  # a Monday
        assert resolve_days("today", today) == (today, today)
        assert resolve_days("yesterday", today) == (
            date(2026, 7, 26),
            date(2026, 7, 26),
        )

    def test_this_week_starts_monday_and_stops_today(self):
        wednesday = date(2026, 7, 29)
        assert resolve_days("this_week", wednesday) == (
            date(2026, 7, 27),
            wednesday,
        )

    def test_last_week_is_the_full_previous_monday_to_sunday(self):
        wednesday = date(2026, 7, 29)
        assert resolve_days("last_week", wednesday) == (
            date(2026, 7, 20),
            date(2026, 7, 26),
        )

    def test_this_month_stops_today_not_at_month_end(self):
        assert resolve_days("this_month", date(2026, 7, 27)) == (
            date(2026, 7, 1),
            date(2026, 7, 27),
        )

    def test_last_month_covers_the_whole_previous_month(self):
        assert resolve_days("last_month", date(2026, 7, 27)) == (
            date(2026, 6, 1),
            date(2026, 6, 30),
        )

    def test_last_month_crosses_the_year_boundary(self):
        assert resolve_days("last_month", date(2026, 1, 15)) == (
            date(2025, 12, 1),
            date(2025, 12, 31),
        )

    def test_last_month_from_march_lands_on_february(self):
        assert resolve_days("last_month", date(2028, 3, 5)) == (
            date(2028, 2, 1),
            date(2028, 2, 29),  # 2028 is a leap year
        )

    def test_rolling_windows_include_today(self):
        today = date(2026, 7, 27)
        assert resolve_days("last_7_days", today) == (date(2026, 7, 21), today)
        assert resolve_days("last_30_days", today) == (date(2026, 6, 28), today)
        assert resolve_days("last_90_days", today) == (date(2026, 4, 29), today)

    def test_this_year(self):
        assert resolve_days("this_year", date(2026, 7, 27)) == (
            date(2026, 1, 1),
            date(2026, 7, 27),
        )

    def test_unknown_period_is_refused_by_name(self):
        with pytest.raises(ToolError) as exc:
            resolve_days("last_fortnight", date(2026, 7, 27))
        assert "last_fortnight" in str(exc.value)


class TestResolvePeriod:
    def test_bounds_are_anchored_on_the_company_clock(self):
        service = FakeService("Asia/Dushanbe")
        start, end, echo = resolve_period(service, "today")

        assert start.tzinfo is not None
        assert str(start.tzinfo) == "Asia/Dushanbe"
        assert start.hour == 0 and start.minute == 0
        assert end.hour == 23 and end.minute == 59
        assert echo["timezone"] == "Asia/Dushanbe"

    def test_two_timezones_disagree_about_when_today_began(self):
        """The point of the whole module: a day boundary is local, not UTC."""
        dushanbe, _, _ = resolve_period(FakeService("Asia/Dushanbe"), "today")
        utc, _, _ = resolve_period(FakeService("UTC"), "today")
        assert dushanbe.utcoffset() != utc.utcoffset()

    def test_echo_reports_the_range_actually_used(self):
        service = FakeService()
        _, _, echo = resolve_period(service, "last_month")
        today = datetime.now(service.tz()).date()
        first, last = resolve_days("last_month", today)
        assert echo["start_date"] == first.isoformat()
        assert echo["end_date"] == last.isoformat()
        assert echo["period"] == "last_month"

    def test_custom_requires_both_dates(self):
        with pytest.raises(ToolError) as exc:
            resolve_period(FakeService(), "custom", start_date="2026-07-01")
        assert "start_date" in str(exc.value)

    def test_custom_accepts_iso_dates(self):
        start, end, echo = resolve_period(
            FakeService(), "custom", start_date="2026-07-01", end_date="2026-07-15"
        )
        assert start.date() == date(2026, 7, 1)
        assert end.date() == date(2026, 7, 15)
        assert echo["period"] == "custom"

    def test_custom_rejects_a_reversed_range(self):
        with pytest.raises(ToolError):
            resolve_period(
                FakeService(),
                "custom",
                start_date="2026-07-15",
                end_date="2026-07-01",
            )

    def test_custom_rejects_unparseable_dates(self):
        with pytest.raises(ToolError) as exc:
            resolve_period(
                FakeService(), "custom", start_date="15.07.2026", end_date="2026-07-20"
            )
        assert "ГГГГ-ММ-ДД" in str(exc.value)

    def test_every_declared_period_resolves(self):
        service = FakeService()
        for period in PERIODS:
            if period == "custom":
                continue
            start, end, _ = resolve_period(service, period)
            assert start <= end, period

    def test_period_name_is_case_insensitive(self):
        _, _, echo = resolve_period(FakeService(), "This_Month")
        assert echo["period"] == "this_month"


class TestReconciliationFloor:
    def test_a_named_period_starts_no_earlier_than_the_reconciliation(self):
        service = FakeService(open_from=date.today())

        start, _, echo = resolve_period(service, "last_90_days")

        assert echo["start_date"] == date.today().isoformat()
        assert echo["reconciled_from"] == date.today().isoformat()

    def test_an_explicit_range_is_honoured_as_asked(self):
        # Reading settled history is not editing it, and a clamp here would make
        # a requested range silently mean something else.
        service = FakeService(open_from=date(2026, 8, 1))

        _, _, echo = resolve_period(
            service, "custom", start_date="2026-01-01", end_date="2026-01-31"
        )

        assert echo["start_date"] == "2026-01-01"
        assert echo["reconciled_from"] == "2026-08-01"
