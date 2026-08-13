"""Is this instant settled, and where does the open period start?

One predicate, one floor. The service guards, the report period resolver, the sales
default and the session payload all read from here — two writers of one rule is how
the sales page and the reports page come to disagree about where the open period
begins.

The comparison is made in DATE space on the company clock: a document belongs to the
settled period when its local calendar day is earlier than `effective_from`. Working
in dates sidesteps every naive-vs-aware trap in one move.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.reconciliation import Reconciliation
from services.company_time import company_tz, local_day_bounds, to_local

_MEMO = "reconciliation_open_from"


class ReconciliationClosed(Exception):
    """A settled document was asked to change. Surfaces as HTTP 409.

    Deliberately not a `ReversalConflict`: `OrderService.cancel` swallows that one
    and cancels the order anyway, which would leave the sale live and the order
    cancelled — worse than the error.
    """


class ReconciliationBlocked(Exception):
    """The checker found drift, so the freeze was refused. Carries the findings."""

    def __init__(self, findings):
        self.findings = findings
        super().__init__("Сверка невозможна: проверка нашла расхождения.")


def open_from(db: Session, company_id: int) -> Optional[date]:
    """The first local day still open, or None when the shop has never reconciled."""
    memo = db.info.setdefault(_MEMO, {})
    if company_id not in memo:
        memo[company_id] = db.execute(
            select(func.max(Reconciliation.effective_from)).where(
                Reconciliation.company_id == company_id
            )
        ).scalar()
    return memo[company_id]


def open_from_instant(db: Session, company_id: int) -> Optional[datetime]:
    """The same floor as an instant, for a query bound."""
    day = open_from(db, company_id)
    if day is None:
        return None
    return local_day_bounds(company_tz(db, company_id), day)[0]


def invalidate(db: Session, company_id: int) -> None:
    db.info.get(_MEMO, {}).pop(company_id, None)


def frozen_reason(
    db: Session, company_id: int, moment: Optional[datetime], subject_ru: str
) -> Optional[str]:
    day = open_from(db, company_id)
    if day is None or moment is None:
        return None
    local_day = to_local(moment, company_tz(db, company_id)).date()
    if local_day >= day:
        return None
    return (
        f"{subject_ru} от {local_day:%d.%m.%Y} относится к периоду до сверки "
        f"от {day:%d.%m.%Y}. Закрытый период не пересчитывается — оформите "
        f"новый документ текущей датой."
    )


def assert_open(
    db: Session, company_id: int, moment: Optional[datetime], subject_ru: str
) -> None:
    reason = frozen_reason(db, company_id, moment, subject_ru)
    if reason:
        raise ReconciliationClosed(reason)
