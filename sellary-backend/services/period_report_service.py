"""What a closed period bought and what it sold.

Every figure is recomputed from the reports it is made of. Nothing is stored on
`company_reconciliations`: a settled total with no independent source is exactly
the drift this codebase keeps learning not to build, and the maintenance scripts
write behind the freeze — a derived report shows the repaired truth, a frozen
column would disagree with every other screen forever.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.reconciliation import Reconciliation
from models.sale import Sale
from models.sale_payment import SalePayment
from models.sale_return import SaleReturn
from models.user import User
from repositories.sale_repository import NON_CANCELLED_STATUSES
from schemas.reconciliation import LateArrivals, PeriodDetail, PeriodList, PeriodRow
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

    def detail(self, reconciliation_id: int) -> Optional[PeriodDetail]:
        item = reconciliation.period(self.db, self.company_id, reconciliation_id)
        if item is None:
            return None

        start, end = self._bounds(item)
        purchases = PurchaseReportService(self.db, self.company_id).summary(start, end)
        profit = ReportService(self.db, self.company_id).get_profit_report(start, end)

        return PeriodDetail(
            id=item.id,
            index=item.index,
            start_day=item.start_day,
            end_day=item.end_day,
            effective_from=item.effective_from,
            note=item.note,
            declared_at=item.created_at,
            declared_by=self._author(item.created_by_user_id),
            purchased=purchases.total_spend,
            receipts_count=purchases.receipts_count,
            sold=profit.revenue,
            sales_count=profit.sales_count,
            cost=profit.cost,
            profit=profit.profit,
            write_off_cost=profit.write_off_cost,
            profit_after_write_offs=profit.profit_after_write_offs,
            returns_total=self._returns(start, end),
            late_arrivals=self._late_arrivals(item, start, end),
            checker_report=self._checker_report(item.id),
        )

    def _author(self, user_id: Optional[int]) -> Optional[str]:
        if user_id is None:
            return None
        row = self.db.execute(
            select(User.full_name, User.username).where(User.id == user_id)
        ).first()
        if row is None:
            return None
        return row.full_name or row.username

    def _returns(self, start: datetime, end: datetime) -> Decimal:
        """Returns against a sale dated inside this period — whenever the return itself happened.

        Keyed on the SALE's date, matching `refund_totals_subquery`
        (`repositories/sale_repository.py`), the one place `sold` is netted of
        returns. Keying on the return's own date instead would make this figure
        disagree with what `sold` actually subtracted: a return can be filed in
        a later period than the sale it settles (`sale_return_service.py` only
        guards the sale's own freeze, not the period about to close), so the
        two dates are not interchangeable.
        """
        return self.db.execute(
            select(
                func.coalesce(func.sum(SaleReturn.total_refund_amount), Decimal("0.00"))
            )
            .select_from(SaleReturn)
            .join(Sale, Sale.id == SaleReturn.sale_id)
            .where(
                SaleReturn.company_id == self.company_id,
                Sale.created_at >= start,
                Sale.created_at <= end,
            )
        ).scalar() or Decimal("0.00")

    def _checker_report(self, reconciliation_id: int) -> Optional[list]:
        return self.db.execute(
            select(Reconciliation.checker_report).where(
                Reconciliation.id == reconciliation_id,
                Reconciliation.company_id == self.company_id,
            )
        ).scalar()

    def _late_arrivals(self, item, start: datetime, end: datetime) -> LateArrivals:
        """Sales dated inside the period whose tenders were written after the freeze.

        A `sale_payments` row is stamped when the server accepts the sale, so
        the earliest one is when the receipt actually reached us. A sale rung
        offline carries its own `created_at` and is never rewritten — the spec
        explains why rewriting it would be worse.
        """
        arrival = (
            select(
                SalePayment.sale_id.label("sale_id"),
                func.min(SalePayment.created_at).label("arrived_at"),
            )
            .group_by(SalePayment.sale_id)
            .subquery()
        )
        count, total = self.db.execute(
            select(
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.total_amount), Decimal("0.00")),
            )
            .join(arrival, arrival.c.sale_id == Sale.id)
            .where(
                Sale.company_id == self.company_id,
                Sale.created_at >= start,
                Sale.created_at <= end,
                Sale.status.in_(NON_CANCELLED_STATUSES),
                arrival.c.arrived_at > item.created_at,
            )
        ).one()
        return LateArrivals(count=int(count or 0), total=total or Decimal("0.00"))
