from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.cash_shift import CashShift, CashShiftSnapshot, CashShiftStatus
from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.sale import PaymentMethod, Sale
from models.sale_return import SaleReturn
from repositories.sale_repository import NON_CANCELLED_STATUSES
from schemas.cash_shift import ShiftTotals
from services.tenant import resolve_company_id

ZERO = Decimal("0.00")


class ShiftConflict(Exception):
    """A shift operation clashed with the one-open-shift-per-company rule."""


class CashShiftService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    # ------------------------------------------------------------------ totals

    def compute_totals(
        self, start: datetime, end: Optional[datetime], opening_cash: Decimal
    ) -> ShiftTotals:
        """Everything that hit the till in [start, end), split by method.

        ONE definition, shared by the live shift view, snapshots, and the close.
        `end=None` means "up to now" (an open shift). Sales, refunds and debt
        repayments are matched by their own timestamp, which is why a sale that
        syncs in late still lands in the correct shift.
        """
        totals = ShiftTotals(expected_cash=opening_cash)

        # --- sales, grouped by (payment_method, card_type) ---
        sale_q = self.db.query(
            Sale.payment_method,
            Sale.card_type,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total_amount), ZERO),
        ).filter(
            Sale.company_id == self.company_id,
            Sale.status.in_(NON_CANCELLED_STATUSES),
            Sale.created_at >= start,
        )
        if end is not None:
            sale_q = sale_q.filter(Sale.created_at < end)
        sale_q = sale_q.group_by(Sale.payment_method, Sale.card_type)

        for method, card_type, count, amount in sale_q.all():
            amount = amount or ZERO
            totals.sales_count += count or 0
            if method == PaymentMethod.CASH:
                totals.cash_sales += amount
            elif method == PaymentMethod.CARD:
                totals.card_sales += amount
                key = card_type.value if hasattr(card_type, "value") else str(card_type or "")
                totals.card_by_type[key] = totals.card_by_type.get(key, ZERO) + amount
            elif method == PaymentMethod.MOBILE:
                totals.mobile_sales += amount
            elif method == PaymentMethod.CREDIT:
                totals.credit_sales += amount

        # --- debt repayments (entry_type='payment'); stored as a NEGATIVE
        #     amount, so cash brought in is the negation ---
        pay_q = (
            self.db.query(
                CustomerLedgerEntry.payment_method,
                func.coalesce(func.sum(CustomerLedgerEntry.amount), ZERO),
            )
            .filter(
                CustomerLedgerEntry.company_id == self.company_id,
                CustomerLedgerEntry.entry_type == CustomerLedgerEntryType.PAYMENT.value,
                CustomerLedgerEntry.created_at >= start,
            )
        )
        if end is not None:
            pay_q = pay_q.filter(CustomerLedgerEntry.created_at < end)
        for method, amount in pay_q.group_by(CustomerLedgerEntry.payment_method).all():
            inflow = -(amount or ZERO)  # payment amounts are negative
            key = (method or "cash").lower()
            totals.debt_payments_by_method[key] = (
                totals.debt_payments_by_method.get(key, ZERO) + inflow
            )

        # --- refunds, by method (money leaving the till) ---
        ref_q = (
            self.db.query(
                SaleReturn.refund_method,
                func.coalesce(func.sum(SaleReturn.total_refund_amount), ZERO),
            )
            .filter(
                SaleReturn.company_id == self.company_id,
                SaleReturn.created_at >= start,
            )
        )
        if end is not None:
            ref_q = ref_q.filter(SaleReturn.created_at < end)
        for method, amount in ref_q.group_by(SaleReturn.refund_method).all():
            key = method.value if hasattr(method, "value") else str(method or "cash")
            totals.refunds_by_method[key] = totals.refunds_by_method.get(key, ZERO) + (amount or ZERO)

        # --- expected cash: only cash movements touch the drawer ---
        cash_debt = totals.debt_payments_by_method.get("cash", ZERO)
        cash_refunds = totals.refunds_by_method.get("cash", ZERO)
        totals.expected_cash = opening_cash + totals.cash_sales + cash_debt - cash_refunds

        return totals

    # -------------------------------------------------------------- operations

    def get_current(self) -> Optional[CashShift]:
        return (
            self.db.query(CashShift)
            .filter(
                CashShift.company_id == self.company_id,
                CashShift.status == CashShiftStatus.OPEN,
            )
            .first()
        )

    def has_open_shift(self) -> bool:
        return self.get_current() is not None

    def open_shift(self, opening_cash: Decimal, user_id: int) -> CashShift:
        next_number = (
            self.db.query(func.coalesce(func.max(CashShift.shift_number), 0))
            .filter(CashShift.company_id == self.company_id)
            .scalar()
        ) + 1
        shift = CashShift(
            company_id=self.company_id,
            shift_number=next_number,
            status=CashShiftStatus.OPEN,
            opened_by_user_id=user_id,
            opening_cash=opening_cash,
        )
        self.db.add(shift)
        try:
            self.db.flush()
        except IntegrityError as exc:
            # The partial unique index fired: another open shift already exists.
            self.db.rollback()
            raise ShiftConflict("Смена уже открыта") from exc
        return shift

    def close_shift(self, shift_id: int, counted_cash: Decimal, notes: Optional[str], user_id: int) -> CashShift:
        shift = (
            self.db.query(CashShift)
            .filter(CashShift.company_id == self.company_id, CashShift.id == shift_id)
            .with_for_update()
            .first()
        )
        if shift is None:
            raise ShiftConflict("Смена не найдена")
        if shift.status != CashShiftStatus.OPEN:
            raise ShiftConflict("Смена уже закрыта")

        closed_at = datetime.now(tz=shift.opened_at.tzinfo)
        totals = self.compute_totals(shift.opened_at, closed_at, Decimal(shift.opening_cash))

        shift.status = CashShiftStatus.CLOSED
        shift.closed_at = closed_at
        shift.closed_by_user_id = user_id
        shift.counted_cash = counted_cash
        shift.expected_cash = totals.expected_cash
        shift.discrepancy = counted_cash - totals.expected_cash
        shift.closing_totals = totals.model_dump(mode="json")
        shift.notes = notes
        self.db.flush()
        return shift

    def take_snapshot(self, shift_id: int, user_id: int) -> CashShiftSnapshot:
        shift = (
            self.db.query(CashShift)
            .filter(CashShift.company_id == self.company_id, CashShift.id == shift_id)
            .first()
        )
        if shift is None or shift.status != CashShiftStatus.OPEN:
            raise ShiftConflict("Смена не открыта")

        now = datetime.now(tz=shift.opened_at.tzinfo)
        totals = self.compute_totals(shift.opened_at, now, Decimal(shift.opening_cash))
        snapshot = CashShiftSnapshot(
            company_id=self.company_id,
            shift_id=shift.id,
            taken_by_user_id=user_id,
            totals=totals.model_dump(mode="json"),
        )
        self.db.add(snapshot)
        self.db.flush()
        return snapshot

    def totals_for(self, shift: CashShift) -> ShiftTotals:
        """Live totals for an open shift; the frozen close for a closed one."""
        if shift.status == CashShiftStatus.CLOSED and shift.closing_totals:
            return ShiftTotals.model_validate(shift.closing_totals)
        return self.compute_totals(shift.opened_at, None, Decimal(shift.opening_cash))
