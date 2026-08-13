"""Recompute every derived figure from an independent source, and report the gaps.

One registry, one place to add a figure. The checker writes nothing: it opens with
``autoflush=False`` and never touches an ORM attribute, because a diagnostic tool that
can write is a diagnostic tool that will eventually write to production.

Where two figures disagree it reports both and names no winner — see «Which side of the
stock invariant is the truth» in CLAUDE.md. The direction of a repair is a judgement
about what happened in the shop, and a tool that guesses it becomes a second opinion.

Every check groups by ``company_id``: a cross-company aggregate lets two shops' opposite
drifts net to zero and report health.
"""

from __future__ import annotations

from collections import namedtuple
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from models.cash_shift import CashShift
from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.inventory_layer import InventoryLayer
from models.money_account import MoneyMovement
from models.product import Product
from models.sale import Sale
from models.sale_payment import SalePayment
from repositories.sale_repository import NON_CANCELLED_STATUSES
from services.tenant import resolve_company_id

ZERO = Decimal("0.00")

# The two legs money moves on. A movement carrying one of these and no
# transfer_group is half a transfer: the other half is missing.
TRANSFER_REASONS = ("transfer_in", "transfer_out")


@dataclass(frozen=True)
class Finding:
    check: str
    company_id: int
    subject: str
    expected: str
    actual: str
    bucket: str = "drift"  # 'drift' — the pair must agree; 'known' — a recorded fact
    note: str = ""


Check = namedtuple("Check", "key title_ru run")


def _stock_vs_layers(db: Session, company_id: int, since: Optional[datetime]) -> list[Finding]:
    """`products.stock_quantity` against the sum of its open FIFO layers."""
    layers = (
        select(
            InventoryLayer.product_id.label("product_id"),
            func.coalesce(func.sum(InventoryLayer.remaining_quantity), 0).label("ledger"),
            func.count(InventoryLayer.id).label("layer_count"),
        )
        .where(InventoryLayer.reversed_at.is_(None))
        .group_by(InventoryLayer.product_id)
        .subquery()
    )
    ledger = func.coalesce(layers.c.ledger, 0)
    stmt = (
        select(
            Product.company_id,
            Product.id,
            Product.name,
            Product.stock_quantity,
            ledger,
            func.coalesce(layers.c.layer_count, 0),
        )
        .outerjoin(layers, layers.c.product_id == Product.id)
        .where(Product.company_id == company_id, Product.stock_quantity != ledger)
        .order_by(Product.id)
    )

    findings = []
    for row_company, product_id, name, balance, layer_sum, layer_count in db.execute(stmt):
        # A sale that synced from an offline cashier is allowed to drive the
        # balance below zero; the layers cannot follow it there. That is a
        # recorded historical fact, not a drift to repair.
        oversold = Decimal(balance) < 0 and not layer_count
        findings.append(
            Finding(
                check="stock_vs_layers",
                company_id=row_company,
                subject=f"товар #{product_id} {name}",
                expected=f"слои {layer_sum}",
                actual=f"остаток {balance}",
                bucket="known" if oversold else "drift",
                note="продажа офлайн в минус" if oversold else "",
            )
        )
    return findings


def _sale_tenders_sum(db: Session, company_id: int, since: Optional[datetime]) -> list[Finding]:
    """Every non-cancelled sale's tenders against its total. `sale_payments` is the money."""
    tenders = (
        select(
            SalePayment.sale_id.label("sale_id"),
            func.coalesce(func.sum(SalePayment.amount), 0).label("tendered"),
            func.count(SalePayment.id).label("tender_count"),
        )
        .group_by(SalePayment.sale_id)
        .subquery()
    )
    tendered = func.coalesce(tenders.c.tendered, 0)
    stmt = (
        select(
            Sale.company_id,
            Sale.id,
            Sale.total_amount,
            tendered,
            func.coalesce(tenders.c.tender_count, 0),
        )
        .outerjoin(tenders, tenders.c.sale_id == Sale.id)
        .where(
            Sale.company_id == company_id,
            Sale.status.in_(NON_CANCELLED_STATUSES),
            Sale.total_amount != tendered,
        )
        .order_by(Sale.id)
    )
    if since is not None:
        stmt = stmt.where(Sale.created_at >= since)

    findings = []
    for row_company, sale_id, total, tendered_sum, tender_count in db.execute(stmt):
        findings.append(
            Finding(
                check="sale_tenders_sum",
                company_id=row_company,
                subject=f"продажа #{sale_id}",
                expected=f"сумма чека {total}",
                actual=f"оплаты {tendered_sum}",
                note="нет ни одной оплаты — чек не виден ни в одном денежном отчёте"
                if not tender_count
                else "",
            )
        )
    return findings


def _shift_totals(db: Session, company_id: int, since: Optional[datetime]) -> list[Finding]:
    """A closed shift's frozen `expected_cash` against today's arithmetic.

    Recomputed by calling the production `compute_totals`, never by restating it.
    At close the till balance replaces the window's own figure and the residual is
    stored as `late_arrivals`, so the identity carries that named line back.
    """
    from services.cash_shift_service import CashShiftService

    stmt = (
        select(CashShift)
        .where(CashShift.company_id == company_id, CashShift.status == "closed")
        .order_by(CashShift.shift_number)
    )
    if since is not None:
        stmt = stmt.where(CashShift.closed_at >= since)

    service = CashShiftService(db, company_id)
    findings = []
    for shift in db.execute(stmt).scalars():
        totals = service.compute_totals(
            shift.opened_at, shift.closed_at, Decimal(shift.opening_cash)
        )
        late = Decimal(str((shift.closing_totals or {}).get("late_arrivals", 0)))
        recomputed = (totals.expected_cash + late).quantize(ZERO)
        stored = Decimal(shift.expected_cash or 0).quantize(ZERO)
        if recomputed != stored:
            findings.append(
                Finding(
                    check="shift_totals",
                    company_id=company_id,
                    subject=f"смена #{shift.shift_number}",
                    expected=f"пересчёт {recomputed}",
                    actual=f"в смене {stored}",
                )
            )
    return findings


def _money_transfer_legs(db: Session, company_id: int, since: Optional[datetime]) -> list[Finding]:
    """A transfer is two legs on two accounts that net to zero, or it is not a transfer."""
    signed = func.sum(
        case((MoneyMovement.direction == "in", MoneyMovement.amount), else_=-MoneyMovement.amount)
    )
    grouped = (
        select(
            MoneyMovement.company_id,
            MoneyMovement.transfer_group,
            func.count(MoneyMovement.id).label("legs"),
            signed.label("net"),
            func.count(func.distinct(MoneyMovement.account_id)).label("accounts"),
        )
        .where(
            MoneyMovement.company_id == company_id,
            MoneyMovement.transfer_group.is_not(None),
        )
        .group_by(MoneyMovement.company_id, MoneyMovement.transfer_group)
        .having((func.count(MoneyMovement.id) != 2) | (signed != 0) | (func.count(func.distinct(MoneyMovement.account_id)) != 2))
    )
    if since is not None:
        grouped = grouped.where(MoneyMovement.created_at >= since)

    findings = [
        Finding(
            check="money_transfer_legs",
            company_id=row_company,
            subject=f"перевод {group}",
            expected="2 ноги на 2 счетах, сумма 0",
            actual=f"{legs} ног(и) на {accounts} счёте(ах), сумма {net}",
        )
        for row_company, group, legs, net, accounts in db.execute(grouped)
    ]

    lone = select(MoneyMovement.company_id, MoneyMovement.id, MoneyMovement.reason).where(
        MoneyMovement.company_id == company_id,
        MoneyMovement.transfer_group.is_(None),
        MoneyMovement.reason.in_(TRANSFER_REASONS),
    )
    if since is not None:
        lone = lone.where(MoneyMovement.created_at >= since)
    findings.extend(
        Finding(
            check="money_transfer_legs",
            company_id=row_company,
            subject=f"движение #{movement_id}",
            expected="перевод из двух ног",
            actual=f"{reason} без пары",
        )
        for row_company, movement_id, reason in db.execute(lone)
    )
    return findings


def _credit_payment_status(db: Session, company_id: int, since: Optional[datetime]) -> list[Finding]:
    """`sales.payment_status` against the customer ledger that decides it.

    The customer balance itself has no cached column, so it cannot drift; the cached
    figure is the status. A credit sale wrongly marked `settled` leaves the open-debt
    list forever — the customer pays and the debt stays on the books.
    """
    from services.customer_ledger_service import CustomerLedgerService

    credit_sales = (
        select(Sale)
        .join(CustomerLedgerEntry, CustomerLedgerEntry.sale_id == Sale.id)
        .where(
            Sale.company_id == company_id,
            Sale.status.in_(NON_CANCELLED_STATUSES),
            CustomerLedgerEntry.entry_type == CustomerLedgerEntryType.CREDIT_SALE.value,
        )
        .distinct()
        .order_by(Sale.id)
    )
    if since is not None:
        credit_sales = credit_sales.where(Sale.created_at >= since)

    service = CustomerLedgerService(db, company_id)
    findings = []
    for sale in db.execute(credit_sales).scalars():
        expected = service.expected_payment_status(sale)
        if sale.payment_status != expected:
            findings.append(
                Finding(
                    check="credit_payment_status",
                    company_id=company_id,
                    subject=f"продажа #{sale.id}",
                    expected=expected,
                    actual=str(sale.payment_status),
                )
            )

    overpaid = (
        select(CustomerLedgerEntry.company_id, CustomerLedgerEntry.customer_id, func.sum(CustomerLedgerEntry.amount))
        .where(CustomerLedgerEntry.company_id == company_id)
        .group_by(CustomerLedgerEntry.company_id, CustomerLedgerEntry.customer_id)
        .having(func.sum(CustomerLedgerEntry.amount) < 0)
    )
    findings.extend(
        Finding(
            check="credit_payment_status",
            company_id=row_company,
            subject=f"клиент #{customer_id}",
            expected="долг не меньше нуля",
            actual=f"баланс {balance}",
        )
        for row_company, customer_id, balance in db.execute(overpaid)
    )
    return findings


def _late_arrivals_after_freeze(
    db: Session, company_id: int, since: Optional[datetime]
) -> list[Finding]:
    """Offline sales that arrived carrying a date inside the settled period.

    They are accepted at their own timestamp — a sale is not an edit — so the
    residual is named here rather than absorbed, the same move the shift panel
    makes with `late_arrivals`. `client_sale_id` already marks the offline
    origin, so no second timestamp is needed to find them.
    """
    from services.reconciliation import open_from_instant

    floor = open_from_instant(db, company_id)
    if floor is None:
        return []

    stmt = (
        select(Sale.company_id, Sale.id, Sale.created_at)
        .where(
            Sale.company_id == company_id,
            Sale.status.in_(NON_CANCELLED_STATUSES),
            Sale.client_sale_id.is_not(None),
            Sale.created_at < floor.replace(tzinfo=None),
        )
        .order_by(Sale.id)
    )
    return [
        Finding(
            check="late_arrivals_after_freeze",
            company_id=row_company,
            subject=f"продажа #{sale_id}",
            expected=f"после {floor:%d.%m.%Y}",
            actual=f"{created_at:%d.%m.%Y}",
            bucket="known",
            note="офлайн-чек пришёл позже сверки",
        )
        for row_company, sale_id, created_at in db.execute(stmt)
    ]


CHECKS: tuple[Check, ...] = (
    Check("stock_vs_layers", "Остаток против слоёв FIFO", _stock_vs_layers),
    Check("sale_tenders_sum", "Оплаты против суммы чека", _sale_tenders_sum),
    Check("shift_totals", "Итоги закрытых смен", _shift_totals),
    Check("money_transfer_legs", "Ноги переводов", _money_transfer_legs),
    Check("credit_payment_status", "Статус оплаты долговых продаж", _credit_payment_status),
    Check("late_arrivals_after_freeze", "Офлайн-чеки после сверки", _late_arrivals_after_freeze),
)


class ConsistencyService:
    def __init__(self, db: Session, company_id: Optional[int] = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def run(self, keys: Optional[Sequence[str]] = None, since: Optional[datetime] = None) -> list[Finding]:
        return self._run_for(self.db, self.company_id, keys, since)

    @classmethod
    def run_all(
        cls,
        db: Session,
        keys: Optional[Sequence[str]] = None,
        since: Optional[datetime] = None,
    ) -> list[Finding]:
        """Every tenant, for the CLI. The API always goes through an instance."""
        from models.company import Company

        findings: list[Finding] = []
        for company_id in db.execute(select(Company.id).order_by(Company.id)).scalars():
            findings.extend(cls._run_for(db, company_id, keys, since))
        return findings

    @staticmethod
    def _run_for(
        db: Session,
        company_id: int,
        keys: Optional[Sequence[str]],
        since: Optional[datetime],
    ) -> list[Finding]:
        previous_autoflush = db.autoflush
        db.autoflush = False
        try:
            return [
                finding
                for check in _selected(keys)
                for finding in check.run(db, company_id, since)
            ]
        finally:
            db.autoflush = previous_autoflush


def _selected(keys: Optional[Sequence[str]]) -> Iterable[Check]:
    if not keys:
        return CHECKS
    unknown = set(keys) - {check.key for check in CHECKS}
    if unknown:
        raise ValueError(f"Unknown check(s): {', '.join(sorted(unknown))}")
    return [check for check in CHECKS if check.key in keys]
