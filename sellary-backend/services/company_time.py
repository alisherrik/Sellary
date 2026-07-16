"""The company's business clock.

The server runs UTC; the shops do not. Anything that closes a day, buckets an
hour, or defaults a date range must ask this module rather than reading the
server clock — a naive `datetime.now()` reported every sale rung before 05:00
local against the previous day.
"""

from datetime import datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from core.config import settings
from models.company import Company

UTC = ZoneInfo("UTC")


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
