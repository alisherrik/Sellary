"""What a closed period bought and what it sold.

Every figure is recomputed from the reports it is made of. Nothing is stored on
`company_reconciliations`: a settled total with no independent source is exactly
the drift this codebase keeps learning not to build, and the maintenance scripts
write behind the freeze — a derived report shows the repaired truth, a frozen
column would disagree with every other screen forever.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from schemas.reconciliation import PeriodList, PeriodRow
from services import reconciliation
from services.company_time import company_tz, local_day_bounds
from services.purchase_report_service import PurchaseReportService
from services.report_service import ReportService
from services.tenant import resolve_company_id

# The oldest period has no start. Every report service requires one, so the
# window opens at an instant no shop has a document before, rather than each
# report growing a nullable-start branch.
_BEGINNING = date(1970, 1, 1)


class PeriodReportService:
    def __init__(self, db: Session, company_id: Optional[int] = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self._tz = company_tz(db, self.company_id)

    def list(self, limit: int = 12, offset: int = 0) -> PeriodList:
        found = reconciliation.periods(self.db, self.company_id)
        return PeriodList(
            total=len(found),
            periods=[self._row(item) for item in found[offset : offset + limit]],
        )

    def _bounds(self, item) -> tuple[datetime, datetime]:
        start, _ = local_day_bounds(self._tz, item.start_day or _BEGINNING)
        _, end = local_day_bounds(self._tz, item.end_day)
        return start, end

    def _row(self, item) -> PeriodRow:
        start, end = self._bounds(item)
        return PeriodRow(
            id=item.id,
            index=item.index,
            start_day=item.start_day,
            end_day=item.end_day,
            note=item.note,
            purchased=PurchaseReportService(self.db, self.company_id)
            .summary(start, end)
            .total_spend,
            sold=ReportService(self.db, self.company_id)
            .get_profit_report(start, end)
            .revenue,
        )
