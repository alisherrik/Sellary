"""Named time periods, resolved on the company's clock.

Tools take `period="last_month"` rather than a pair of dates because date
arithmetic is exactly where a model makes a quiet mistake, and a report for the
wrong month looks just as plausible as one for the right month.

Every boundary comes from `local_day_bounds`, so a day ends when the shop's day
ends. On a server running UTC and a shop in Dushanbe those differ by five
hours — enough to move an evening's takings into the wrong report.
"""

from datetime import date, datetime, timedelta

from fastmcp.exceptions import ToolError

PERIODS = (
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "last_7_days",
    "last_30_days",
    "last_90_days",
    "this_year",
    "custom",
)

PERIOD_LABELS_RU = {
    "today": "сегодня",
    "yesterday": "вчера",
    "this_week": "текущая неделя",
    "last_week": "прошлая неделя",
    "this_month": "текущий месяц",
    "last_month": "прошлый месяц",
    "last_7_days": "последние 7 дней",
    "last_30_days": "последние 30 дней",
    "last_90_days": "последние 90 дней",
    "this_year": "текущий год",
    "custom": "произвольный период",
}


def _parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value.strip()[:10])
    except (ValueError, AttributeError):
        raise ToolError(
            f"Не удалось прочитать {field}: «{value}». Ожидается формат ГГГГ-ММ-ДД."
        )


def _month_start(day: date) -> date:
    return day.replace(day=1)


def _previous_month_range(day: date) -> tuple[date, date]:
    first_of_this = _month_start(day)
    last_of_prev = first_of_this - timedelta(days=1)
    return _month_start(last_of_prev), last_of_prev


def resolve_days(period: str, today: date) -> tuple[date, date]:
    """The first and last local *days* a period covers, both inclusive.

    Weeks start Monday. `this_week` and `this_month` run up to today rather
    than to the end of the calendar period, because a report cannot cover days
    that have not happened.
    """
    if period == "today":
        return today, today
    if period == "yesterday":
        yesterday = today - timedelta(days=1)
        return yesterday, yesterday
    if period == "this_week":
        return today - timedelta(days=today.weekday()), today
    if period == "last_week":
        this_monday = today - timedelta(days=today.weekday())
        last_monday = this_monday - timedelta(days=7)
        return last_monday, last_monday + timedelta(days=6)
    if period == "this_month":
        return _month_start(today), today
    if period == "last_month":
        return _previous_month_range(today)
    if period == "last_7_days":
        return today - timedelta(days=6), today
    if period == "last_30_days":
        return today - timedelta(days=29), today
    if period == "last_90_days":
        return today - timedelta(days=89), today
    if period == "this_year":
        return date(today.year, 1, 1), today

    raise ToolError(
        f"Неизвестный период «{period}». Доступны: {', '.join(PERIODS)}."
    )


def resolve_period(
    service,
    period: str = "this_month",
    start_date: str | None = None,
    end_date: str | None = None,
) -> tuple[datetime, datetime, dict]:
    """Return the instants to query with, plus the echo block for the answer.

    `service` is any service exposing `tz()` and `local_day_bounds()` —
    `ReportService` and `PurchaseReportService` both do.
    """
    period = (period or "this_month").strip().lower()
    if period not in PERIODS:
        raise ToolError(
            f"Неизвестный период «{period}». Доступны: {', '.join(PERIODS)}."
        )

    tz = service.tz()
    today = datetime.now(tz).date()

    if period == "custom":
        if not start_date or not end_date:
            raise ToolError(
                "Для произвольного периода укажите start_date и end_date "
                "в формате ГГГГ-ММ-ДД."
            )
        first_day = _parse_date(start_date, "start_date")
        last_day = _parse_date(end_date, "end_date")
        if first_day > last_day:
            raise ToolError("Начало периода позже его конца.")
    else:
        first_day, last_day = resolve_days(period, today)
        # A named period is a request for "the recent past", so it starts no
        # earlier than the reconciliation. An explicit custom range is honoured
        # as asked: reading settled history is not editing it.
        open_from = service.open_from()
        if open_from and open_from > first_day:
            first_day = open_from

    start, _ = service.local_day_bounds(first_day)
    _, end = service.local_day_bounds(last_day)

    return start, end, {
        "period": period,
        "period_label": PERIOD_LABELS_RU.get(period, period),
        "start_date": first_day.isoformat(),
        "end_date": last_day.isoformat(),
        "timezone": str(tz),
        # So a model reading across the cut-off says so instead of averaging two eras.
        "reconciled_from": service.open_from().isoformat() if service.open_from() else None,
    }
