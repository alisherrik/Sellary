"""The company's business clock.

The server runs UTC; the shops do not. Anything that closes a day, buckets an
hour, or defaults a date range must ask this module rather than reading the
server clock — a naive `datetime.now()` reported every sale rung before 05:00
local against the previous day.
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from core.config import settings
from models.company import Company

UTC = ZoneInfo("UTC")


def utc_now() -> datetime:
    """The instant to stamp a row with.

    Naive, but naive *UTC* — matching what `func.now()` writes for every
    server-defaulted column, so the two never disagree. A bare
    `datetime.now()` is the server's local wall clock, which silently offsets
    every row it stamps on any host that is not UTC and puts sales outside the
    till shift that contains them.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def company_tz(db: Session, company_id: int) -> ZoneInfo:
    name = (
        db.query(Company.timezone).filter(Company.id == company_id).scalar()
        or settings.DEFAULT_TIMEZONE
    )
    return ZoneInfo(name)


def to_local(moment: datetime, tz: ZoneInfo) -> datetime:
    """Read a stored timestamp on the company's clock.

    Postgres hands back an aware timestamptz; the SQLite test engine hands back
    a naive one that is UTC by construction.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(tz)


def period_range(service, start_date=None, end_date=None, days: int = 30) -> tuple[datetime, datetime]:
    """Fill in a missing report range on the company's clock, no earlier than the cut-off.

    Duck-typed on `tz()` / `local_day_bounds()` / `open_from()`, so the sales reports
    and the purchase reports share one rule instead of two that drift apart.

    The floor fills in a MISSING start and never truncates an explicit one: reading
    pre-reconciliation history is not editing it, and a hard clamp would make
    «за последние 90 дней» quietly mean twelve.
    """
    tz = service.tz()
    if not end_date:
        _, end_date = service.local_day_bounds()
    if not start_date:
        first_day = datetime.now(tz).date() - timedelta(days=max(days - 1, 0))
        open_from = service.open_from()
        if open_from and open_from > first_day:
            first_day = open_from
        start_date, _ = service.local_day_bounds(first_day)
    return start_date, end_date


def local_day_bounds(tz: ZoneInfo, day=None) -> tuple[datetime, datetime]:
    """Start/end of a local business day, as instants the DB can compare.

    `created_at` is timestamptz, so aware bounds let Postgres compare in
    absolute time. A naive local midnight would silently mean UTC midnight.
    """
    day = day or datetime.now(tz).date()
    return (
        datetime.combine(day, time.min, tzinfo=tz),
        datetime.combine(day, time.max, tzinfo=tz),
    )
