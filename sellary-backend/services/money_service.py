"""Money accounts and the movements between them.

Business rules live here; the repository only reads. Three of them matter:

- a movement is immutable, so a mistake is corrected by an opposing movement
  and the history keeps saying what happened;
- a transfer is written as two legs at once, never as a lone deposit and a
  hopefully-matching withdrawal later;
- nothing here touches `sales`, so recording that cash went to the bank cannot
  change a single figure in the sales reports.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.cash_shift import CashShift, CashShiftStatus
from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.money_account import (
    IN_REASONS,
    OUT_REASONS,
    MoneyAccount,
    MoneyMovement,
)
from models.sale import PaymentMethod, Sale
from models.sale_payment import SalePayment
from models.sale_return import SaleReturn
from repositories.money_repository import (
    MoneyRepository,
    cash_payment_filter,
    cash_refund_filter,
)
from schemas.money import (
    BalanceCorrection,
    MoneyAccountOut,
    MoneyOverview,
    MovementCreate,
    MovementOut,
    TransferCreate,
)
from services.company_time import utc_now
from services.tenant import resolve_company_id

ZERO = Decimal("0.00")

CARD_LABELS = {"dc": "DC", "eskhata": "Эсхата", "alif": "Alif"}

REASON_LABELS = {
    "transfer_in": "Перевод (приход)",
    "owner_deposit": "Внесение владельцем",
    "change_float": "Размен",
    "adjustment_in": "Корректировка остатка (+)",
    "other_income": "Прочий приход",
    "transfer_out": "Перевод (расход)",
    "bank_deposit": "Сдача в банк",
    "supplier_payment": "Оплата поставщику",
    "expense": "Расходы магазина",
    "salary": "Зарплата",
    "owner_withdrawal": "Изъятие владельцем",
    "adjustment_out": "Корректировка остатка (−)",
    "other_expense": "Прочий расход",
}


class MoneyError(Exception):
    """A movement was refused. Maps to HTTP 400/409 at the edge."""


class MoneyService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.repo = MoneyRepository(db)

    # -------------------------------------------------------------- accounts

    def ensure_accounts(self) -> None:
        """Create the accounts the company's own data implies.

        The migration seeded existing companies. This covers what happens
        afterwards: a company created since, and — the common case — the first
        sale on a card type nobody had used before. Without it that money would
        land on «Банк (прочее)» and the owner would see a lump they cannot
        explain.
        """
        till = self.repo.till(self.company_id)
        if till is None:
            till = MoneyAccount(
                company_id=self.company_id,
                name="Касса",
                is_till=True,
                sort_order=0,
            )
            self.db.add(till)
            self.db.flush()

        known = {a.card_type for a in self.repo.accounts(self.company_id, include_inactive=True)}
        # Read from the tenders: a sale paid partly on DC and partly on Эсхата
        # names only one of them in `sales.card_type`, and the other bank would
        # never get an account of its own.
        used = {
            row[0]
            for row in self.db.query(SalePayment.card_type)
            .join(Sale, Sale.id == SalePayment.sale_id)
            .filter(
                Sale.company_id == self.company_id,
                SalePayment.card_type.isnot(None),
            )
            .distinct()
            .all()
        }
        for card_type in sorted(used - known):
            # `card_type` hands back a CardType member. It subclasses str, so
            # the set arithmetic above matches the plain strings already
            # stored — but `str()` on it is "CardType.DC", so the value is
            # taken explicitly rather than left to whatever coerces it.
            value = card_type.value if hasattr(card_type, "value") else str(card_type)
            self.db.add(
                MoneyAccount(
                    company_id=self.company_id,
                    name=f"Банк · {CARD_LABELS.get(value, value)}",
                    is_till=False,
                    card_type=value,
                    sort_order=self.repo.next_sort_order(self.company_id),
                )
            )
            self.db.flush()

        # The catch-all is created only when something would otherwise fall
        # through it: a mobile payment, a card refund, a debt repaid by card.
        if self.repo.other_noncash(self.company_id) is None and self._has_unattributable_noncash():
            self.repo.ensure_other_noncash(self.company_id)

    def _has_unattributable_noncash(self) -> bool:
        mobile = (
            self.db.query(SalePayment.id)
            .join(Sale, Sale.id == SalePayment.sale_id)
            .filter(
                Sale.company_id == self.company_id,
                SalePayment.method == PaymentMethod.MOBILE,
            )
            .first()
        )
        if mobile is not None:
            return True
        refund = (
            self.db.query(SaleReturn.id)
            .filter(
                SaleReturn.company_id == self.company_id,
                cash_refund_filter(cash=False),
            )
            .first()
        )
        if refund is not None:
            return True
        payment = (
            self.db.query(CustomerLedgerEntry.id)
            .filter(
                CustomerLedgerEntry.company_id == self.company_id,
                CustomerLedgerEntry.entry_type == CustomerLedgerEntryType.PAYMENT.value,
                cash_payment_filter(cash=False),
            )
            .first()
        )
        return payment is not None

    def overview(self, include_inactive: bool = False) -> MoneyOverview:
        self.ensure_accounts()
        accounts = self.repo.accounts(self.company_id, include_inactive)
        balances = self.repo.balances(self.company_id, accounts)
        rows = [
            MoneyAccountOut(
                id=a.id,
                name=a.name,
                is_till=a.is_till,
                card_type=a.card_type,
                balance=balances.get(a.id, ZERO),
                opening_balance=Decimal(a.opening_balance or 0),
                opening_at=a.opening_at,
                is_active=a.is_active,
                sort_order=a.sort_order,
            )
            for a in accounts
        ]
        return MoneyOverview(
            accounts=rows,
            total=sum((r.balance for r in rows), ZERO),
            cash_total=sum((r.balance for r in rows if r.is_till), ZERO),
            noncash_total=sum((r.balance for r in rows if not r.is_till), ZERO),
        )

    def create_account(self, name: str, opening_balance: Decimal, user_id: int) -> MoneyAccount:
        """A plain account the owner adds by hand: a safe, a second bank.

        The till and the per-card-type accounts are not created this way — the
        migration makes the till, and a card account appears with the first
        sale on that card type.
        """
        account = MoneyAccount(
            company_id=self.company_id,
            name=name.strip(),
            is_till=False,
            card_type=None,
            is_other_noncash=False,
            opening_balance=opening_balance,
            sort_order=self.repo.next_sort_order(self.company_id),
        )
        self.db.add(account)
        self.db.flush()
        return account

    def update_account(self, account_id: int, **fields) -> MoneyAccount:
        account = self.repo.get_account(self.company_id, account_id)
        if account is None:
            raise MoneyError("Счёт не найден")
        for key, value in fields.items():
            if value is not None:
                setattr(account, key, value)
        if account.is_till and account.is_active is False:
            raise MoneyError("Кассу нельзя отключить — на неё опирается смена")
        self.db.flush()
        return account

    # ------------------------------------------------------------- movements

    def _guard_till_shift(self, account: MoneyAccount) -> None:
        """Money leaves and enters the drawer only while a shift is open.

        A till movement outside a shift belongs to no reconciliation, and one
        recorded into a closed shift would change a figure the cashier was
        already judged against — the same reason a receipt in a closed shift
        can no longer be annulled.
        """
        if not account.is_till:
            return
        open_shift = (
            self.db.query(CashShift)
            .filter(
                CashShift.company_id == self.company_id,
                CashShift.status == CashShiftStatus.OPEN,
            )
            .first()
        )
        if open_shift is None:
            raise MoneyError(
                "Смена не открыта. Движение денег по кассе записывается только "
                "в открытую смену."
            )

    def record(self, payload: MovementCreate, user_id: int) -> MoneyMovement:
        account = self.repo.get_account(self.company_id, payload.account_id)
        if account is None:
            raise MoneyError("Счёт не найден")
        if not account.is_active:
            raise MoneyError("Счёт отключён")
        if payload.reason not in (IN_REASONS + OUT_REASONS):
            raise MoneyError("Неизвестная причина движения")
        self._guard_till_shift(account)

        movement = MoneyMovement(
            company_id=self.company_id,
            account_id=account.id,
            direction=payload.direction,
            amount=payload.amount,
            reason=payload.reason,
            note=(payload.note or None),
            created_by_user_id=user_id,
            created_at=utc_now(),
        )
        self.db.add(movement)
        self.db.flush()
        return movement

    def transfer(self, payload: TransferCreate, user_id: int) -> list[MoneyMovement]:
        if payload.from_account_id == payload.to_account_id:
            raise MoneyError("Счёт списания и счёт зачисления совпадают")
        source = self.repo.get_account(self.company_id, payload.from_account_id)
        target = self.repo.get_account(self.company_id, payload.to_account_id)
        if source is None or target is None:
            raise MoneyError("Счёт не найден")
        if not source.is_active or not target.is_active:
            raise MoneyError("Счёт отключён")
        self._guard_till_shift(source)
        self._guard_till_shift(target)

        group = uuid.uuid4().hex
        note = payload.note or None
        # Both legs share one instant: a transfer is a single event, and a
        # shift window must never contain one half of it.
        now = utc_now()
        legs = [
            MoneyMovement(
                company_id=self.company_id,
                account_id=source.id,
                direction="out",
                amount=payload.amount,
                reason="transfer_out",
                transfer_group=group,
                note=note,
                created_by_user_id=user_id,
                created_at=now,
            ),
            MoneyMovement(
                company_id=self.company_id,
                account_id=target.id,
                direction="in",
                amount=payload.amount,
                reason="transfer_in",
                transfer_group=group,
                note=note,
                created_by_user_id=user_id,
                created_at=now,
            ),
        ]
        self.db.add_all(legs)
        self.db.flush()
        return legs

    def correct_balance(self, payload: BalanceCorrection, user_id: int) -> Optional[MoneyMovement]:
        account = self.repo.get_account(self.company_id, payload.account_id)
        if account is None:
            raise MoneyError("Счёт не найден")
        current = self.repo.balances(self.company_id, [account]).get(account.id, ZERO)
        difference = (payload.actual_balance - current).quantize(ZERO)
        if difference == 0:
            return None
        self._guard_till_shift(account)
        movement = MoneyMovement(
            company_id=self.company_id,
            account_id=account.id,
            direction="in" if difference > 0 else "out",
            amount=abs(difference),
            reason="adjustment_in" if difference > 0 else "adjustment_out",
            note=payload.note or f"Остаток приведён к {payload.actual_balance}",
            created_by_user_id=user_id,
            created_at=utc_now(),
        )
        self.db.add(movement)
        self.db.flush()
        return movement

    # ----------------------------------------------------------------- reads

    def history(
        self,
        account_id: Optional[int] = None,
        start=None,
        end=None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[MovementOut]:
        rows = self.repo.movements(self.company_id, account_id, start, end, limit, offset)
        return [self.to_out(row) for row in rows]

    @staticmethod
    def to_out(movement: MoneyMovement) -> MovementOut:
        user = movement.created_by_user
        return MovementOut(
            id=movement.id,
            account_id=movement.account_id,
            account_name=movement.account.name if movement.account else "",
            direction=movement.direction,
            amount=Decimal(movement.amount),
            reason=movement.reason,
            reason_label=REASON_LABELS.get(movement.reason, movement.reason),
            transfer_group=movement.transfer_group,
            note=movement.note,
            created_by_user_id=movement.created_by_user_id,
            created_by_name=(getattr(user, "full_name", None) or getattr(user, "username", None))
            if user
            else None,
            created_at=movement.created_at,
        )
