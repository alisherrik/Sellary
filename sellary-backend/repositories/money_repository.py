"""Reads for money accounts: balances, movements, and the till's own history.

A balance is computed on every read, never stored. It is the account's opening
figure plus everything recorded since — the deliberate movements in
`money_movements`, and the sales, refunds and debt repayments already recorded
elsewhere. Nothing is mirrored, so nothing can drift out of step.
"""
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.money_account import MoneyAccount, MoneyMovement
from models.sale import PaymentMethod, Sale
from models.sale_payment import SalePayment
from models.sale_return import SaleReturn
from repositories.sale_repository import NON_CANCELLED_STATUSES

ZERO = Decimal("0.00")


def cash_refund_filter(cash: bool):
    """Whether a refund left the drawer.

    A module-level expression rather than an inline filter so a test can
    compile it against the Postgres dialect. `refund_method` is a native
    Postgres enum: the natural-looking `func.lower(coalesce(...))` works on the
    SQLite test engine and then fails in production with `function
    lower(paymentmethod) does not exist`.
    """
    is_cash = SaleReturn.refund_method == PaymentMethod.CASH
    return is_cash if cash else ~is_cash


def cash_payment_filter(cash: bool):
    """Whether a debt repayment arrived in the drawer.

    `customer_ledger_entries.payment_method` is a plain String(20) — free text
    written by whatever recorded the payment — so it is normalised, not
    compared to an enum. The asymmetry with `cash_refund_filter` is real and
    deliberate.
    """
    method = func.lower(func.coalesce(CustomerLedgerEntry.payment_method, "cash"))
    return method == "cash" if cash else method != "cash"


class MoneyRepository:
    def __init__(self, db: Session):
        self.db = db

    # ---------------------------------------------------------------- accounts

    def accounts(self, company_id: int, include_inactive: bool = False) -> list[MoneyAccount]:
        query = self.db.query(MoneyAccount).filter(MoneyAccount.company_id == company_id)
        if not include_inactive:
            query = query.filter(MoneyAccount.is_active.is_(True))
        return query.order_by(MoneyAccount.sort_order, MoneyAccount.id).all()

    def get_account(self, company_id: int, account_id: int) -> Optional[MoneyAccount]:
        return (
            self.db.query(MoneyAccount)
            .filter(MoneyAccount.company_id == company_id, MoneyAccount.id == account_id)
            .first()
        )

    def till(self, company_id: int) -> Optional[MoneyAccount]:
        return (
            self.db.query(MoneyAccount)
            .filter(MoneyAccount.company_id == company_id, MoneyAccount.is_till.is_(True))
            .first()
        )

    def other_noncash(self, company_id: int) -> Optional[MoneyAccount]:
        """«Банк (прочее)» — where non-cash money with no card type lands."""
        return (
            self.db.query(MoneyAccount)
            .filter(
                MoneyAccount.company_id == company_id,
                MoneyAccount.is_other_noncash.is_(True),
            )
            .first()
        )

    def ensure_other_noncash(self, company_id: int) -> MoneyAccount:
        """The catch-all account, created on first need.

        Non-cash money that carries no card type has to land somewhere or it
        would silently vanish from the totals.
        """
        existing = self.other_noncash(company_id)
        if existing is not None:
            return existing
        account = MoneyAccount(
            company_id=company_id,
            name="Банк (прочее)",
            is_till=False,
            is_other_noncash=True,
            sort_order=self.next_sort_order(company_id),
        )
        self.db.add(account)
        self.db.flush()
        return account

    def next_sort_order(self, company_id: int) -> int:
        current = (
            self.db.query(func.coalesce(func.max(MoneyAccount.sort_order), 0))
            .filter(MoneyAccount.company_id == company_id)
            .scalar()
        )
        return int(current or 0) + 1

    # -------------------------------------------------------------- balances

    def balances(self, company_id: int, accounts: Sequence[MoneyAccount]) -> dict[int, Decimal]:
        """Current balance per account id.

        Four sources, each anchored on the account's own `opening_at` so a
        balance that was set as a correction does not double-count the history
        before it.
        """
        if not accounts:
            return {}

        result = {account.id: Decimal(account.opening_balance or 0) for account in accounts}

        # 1. Deliberate movements.
        movement_rows = (
            self.db.query(
                MoneyMovement.account_id,
                MoneyMovement.direction,
                func.coalesce(func.sum(MoneyMovement.amount), ZERO),
            )
            .join(MoneyAccount, MoneyAccount.id == MoneyMovement.account_id)
            .filter(
                MoneyMovement.company_id == company_id,
                MoneyMovement.created_at >= MoneyAccount.opening_at,
            )
            .group_by(MoneyMovement.account_id, MoneyMovement.direction)
            .all()
        )
        for account_id, direction, amount in movement_rows:
            if account_id not in result:
                continue
            amount = Decimal(amount or 0)
            result[account_id] += amount if direction == "in" else -amount

        till = next((a for a in accounts if a.is_till), None)
        by_card = {a.card_type: a for a in accounts if a.card_type}
        other = next((a for a in accounts if a.is_other_noncash), None)

        # 2. Sales. Cash lands in the drawer; a card sale lands on that card's
        #    account; a mobile payment or a card type with no account of its own
        #    falls through to «Банк (прочее)».
        # The group-by enumerates which (method, card type) pairs exist; the sum
        # is taken per account afterwards, because each account counts from its
        # own `opening_at` and those differ.
        # Read per tender, not per sale: a sale settled 26 наличными and 10 on a
        # DC card puts 26 in the drawer and 10 on the DC account, and routing
        # its whole 50 by a single column would credit one of them twice over.
        combinations = (
            self.db.query(SalePayment.method, SalePayment.card_type)
            .join(Sale, Sale.id == SalePayment.sale_id)
            .filter(
                Sale.company_id == company_id,
                Sale.status.in_(NON_CANCELLED_STATUSES),
            )
            .group_by(SalePayment.method, SalePayment.card_type)
            .all()
        )
        for method, card_type in combinations:
            target = self._route_sale(method, card_type, till, by_card, other)
            if target is None:
                continue
            result[target.id] += self._sum_sales(company_id, method, card_type, target.opening_at)

        # 3. Debt repayments — money coming in against an earlier credit sale.
        for method, account in self._noncash_and_cash_targets(till, other):
            result[account.id] += self._sum_debt_payments(company_id, method, account.opening_at)

        # 4. Refunds — money going back out.
        for method, account in self._noncash_and_cash_targets(till, other):
            result[account.id] -= self._sum_refunds(company_id, method, account.opening_at)

        return {account_id: value.quantize(ZERO) for account_id, value in result.items()}

    @staticmethod
    def _route_sale(method, card_type, till, by_card, other):
        value = method.value if hasattr(method, "value") else str(method)
        if value == PaymentMethod.CASH.value:
            return till
        if value == PaymentMethod.CREDIT.value:
            # Nothing moved: the goods left, the money did not.
            return None
        if value == PaymentMethod.CARD.value:
            key = card_type.value if hasattr(card_type, "value") else card_type
            return by_card.get(key) or other
        return other  # mobile

    @staticmethod
    def _noncash_and_cash_targets(till, other) -> Iterable[tuple[str, MoneyAccount]]:
        """`refund_method` and `payment_method` say cash or not, never which card."""
        if till is not None:
            yield "cash", till
        if other is not None:
            yield "noncash", other

    def _sum_sales(self, company_id: int, method, card_type, since) -> Decimal:
        query = (
            self.db.query(func.coalesce(func.sum(SalePayment.amount), ZERO))
            .join(Sale, Sale.id == SalePayment.sale_id)
            .filter(
                Sale.company_id == company_id,
                Sale.status.in_(NON_CANCELLED_STATUSES),
                SalePayment.method == method,
                Sale.created_at >= since,
            )
        )
        query = (
            query.filter(SalePayment.card_type.is_(None))
            if card_type is None
            else query.filter(SalePayment.card_type == card_type)
        )
        return Decimal(query.scalar() or 0)

    def _sum_debt_payments(self, company_id: int, bucket: str, since) -> Decimal:
        # Stored negative: a repayment reduces what the customer owes, so the
        # cash coming in is the negation.
        query = self.db.query(func.coalesce(-func.sum(CustomerLedgerEntry.amount), ZERO)).filter(
            CustomerLedgerEntry.company_id == company_id,
            CustomerLedgerEntry.entry_type == CustomerLedgerEntryType.PAYMENT.value,
            CustomerLedgerEntry.created_at >= since,
            cash_payment_filter(bucket == "cash"),
        )
        return Decimal(query.scalar() or 0)

    def _sum_refunds(self, company_id: int, bucket: str, since) -> Decimal:
        # Net of the part written off the customer's debt: that never left an
        # account, so subtracting it from one would invent money going out.
        query = self.db.query(
            func.coalesce(
                func.sum(
                    SaleReturn.total_refund_amount
                    - func.coalesce(SaleReturn.credit_refund_amount, ZERO)
                ),
                ZERO,
            )
        ).filter(
            SaleReturn.company_id == company_id,
            SaleReturn.created_at >= since,
            cash_refund_filter(bucket == "cash"),
        )
        return Decimal(query.scalar() or 0)

    def till_balance(self, company_id: int) -> Optional[Decimal]:
        """What the drawer holds according to the documents.

        The single answer to "how much cash is there", shared by the money page
        and by the shift's «Ожидается в кассе». `None` when the company has no
        till account yet — then the shift falls back to its own window
        arithmetic, which is all there is to go on.
        """
        till = self.till(company_id)
        if till is None:
            return None
        return self.balances(company_id, [till]).get(till.id, ZERO)

    # ------------------------------------------------------------- movements

    def movements(
        self,
        company_id: int,
        account_id: Optional[int] = None,
        start=None,
        end=None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[MoneyMovement]:
        query = (
            self.db.query(MoneyMovement)
            .options(joinedload(MoneyMovement.account), joinedload(MoneyMovement.created_by_user))
            .filter(MoneyMovement.company_id == company_id)
        )
        if account_id is not None:
            query = query.filter(MoneyMovement.account_id == account_id)
        if start is not None:
            query = query.filter(MoneyMovement.created_at >= start)
        if end is not None:
            query = query.filter(MoneyMovement.created_at < end)
        return (
            query.order_by(MoneyMovement.created_at.desc(), MoneyMovement.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def till_movements_between(self, company_id: int, start, end) -> list[MoneyMovement]:
        """Till movements inside a shift window, for the shift's arithmetic."""
        till = self.till(company_id)
        if till is None:
            return []
        query = self.db.query(MoneyMovement).filter(
            MoneyMovement.company_id == company_id,
            MoneyMovement.account_id == till.id,
            MoneyMovement.created_at >= start,
        )
        if end is not None:
            query = query.filter(MoneyMovement.created_at < end)
        return query.order_by(MoneyMovement.created_at, MoneyMovement.id).all()
