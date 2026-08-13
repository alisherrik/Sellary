"""Declaring a reconciliation: the act of settling everything before a date."""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.reconciliation import Reconciliation
from services import reconciliation
from services.company_time import company_tz
from services.consistency_service import ConsistencyService
from services.reconciliation import ReconciliationBlocked
from services.tenant import resolve_company_id


class ReconciliationService:
    def __init__(self, db: Session, company_id: Optional[int] = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def latest(self) -> Optional[Reconciliation]:
        return self.db.execute(self._ordered().limit(1)).scalars().first()

    def history(self, limit: int = 50, offset: int = 0) -> list[Reconciliation]:
        return list(self.db.execute(self._ordered().limit(limit).offset(offset)).scalars())

    def check(self):
        return ConsistencyService(self.db, self.company_id).run()

    def create(
        self,
        effective_from: date,
        note: Optional[str],
        user_id: int,
        acknowledge_violations: bool = False,
    ) -> Reconciliation:
        today = datetime.now(company_tz(self.db, self.company_id)).date()
        if effective_from > today:
            # A future floor would push the dashboard's own «today» window behind
            # it and render every defaulted report empty.
            raise ValueError("Дата сверки не может быть в будущем.")

        previous = self.latest()
        if previous and effective_from <= previous.effective_from:
            raise ValueError(
                f"Сверка уже проведена по {previous.effective_from:%d.%m.%Y} — "
                "новая дата должна быть позже."
            )

        if self._open_shift() is not None:
            # A cut-off inside an open shift splits that shift's own arithmetic
            # across the boundary — and it is what lets the shift's backdated
            # count correction stay unguarded.
            raise ValueError("Сначала закройте смену: сверка проводится между сменами.")

        findings = self.check()
        drift = [finding for finding in findings if finding.bucket == "drift"]
        if drift and not acknowledge_violations:
            # Freezing over known drift bakes it into a carried-forward opening
            # position at the moment the repair scripts stop being usable.
            raise ReconciliationBlocked(drift)

        row = Reconciliation(
            company_id=self.company_id,
            effective_from=effective_from,
            note=note,
            created_by_user_id=user_id,
            checker_report=[finding.__dict__ for finding in drift] or None,
        )
        self.db.add(row)
        self.db.flush()
        reconciliation.invalidate(self.db, self.company_id)
        return row

    def _ordered(self):
        return (
            select(Reconciliation)
            .where(Reconciliation.company_id == self.company_id)
            .order_by(Reconciliation.effective_from.desc(), Reconciliation.id.desc())
        )

    def _open_shift(self):
        from services.cash_shift_service import CashShiftService

        return CashShiftService(self.db, self.company_id).get_current()
