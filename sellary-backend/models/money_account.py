"""Where the shop's money sits, and every time it moves between those places.

The till drawer, the bank account behind each card type, a safe — each is a
`MoneyAccount`. A `MoneyMovement` records money entering or leaving one of them
for a reason that no other document already covers: a transfer, a deposit, a
supplier paid in cash, wages.

Sales, refunds and debt repayments are NOT written here. They are already
recorded in `sales`, `sale_returns` and `customer_ledger_entries`, and a balance
reads from those directly — see `MoneyRepository.balances`. A journal that
mirrored them would have to be kept in step by every write path, and the
production database already shows what that costs: four products whose
`stock_quantity` disagrees with their FIFO layers because a manual edit, a
delete and a purchase void each moved one and not the other.
"""
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base

# Money entering an account.
IN_REASONS = (
    "transfer_in",
    "owner_deposit",
    "change_float",
    "adjustment_in",
    "other_income",
)

# Money leaving it.
OUT_REASONS = (
    "transfer_out",
    "bank_deposit",
    "supplier_payment",
    "expense",
    "salary",
    "owner_withdrawal",
    "adjustment_out",
    "other_expense",
)

REASONS = IN_REASONS + OUT_REASONS

# The two legs of a transfer are created together and never on their own.
TRANSFER_REASONS = ("transfer_in", "transfer_out")


class MoneyAccount(Base):
    __tablename__ = "money_accounts"
    __table_args__ = (
        # Exactly one drawer per company: the shift's cash reconciliation has
        # to have a single unambiguous target.
        Index(
            "uq_money_accounts_one_till_per_company",
            "company_id",
            unique=True,
            postgresql_where=text("is_till"),
            sqlite_where=text("is_till"),
        ),
        # One account per card type, so a card sale routes without a choice.
        Index(
            "uq_money_accounts_company_card_type",
            "company_id",
            "card_type",
            unique=True,
            postgresql_where=text("card_type IS NOT NULL"),
            sqlite_where=text("card_type IS NOT NULL"),
        ),
        # One «Банк (прочее)»: the destination for non-cash money that carries
        # no card type — a card refund, a debt repaid by card. Flagged rather
        # than inferred from `card_type IS NULL`, so an owner can still add as
        # many plain accounts (a safe, a second bank) as they like.
        Index(
            "uq_money_accounts_one_other_noncash",
            "company_id",
            unique=True,
            postgresql_where=text("is_other_noncash"),
            sqlite_where=text("is_other_noncash"),
        ),
        Index("ix_money_accounts_company_sort", "company_id", "sort_order"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(60), nullable=False)
    is_till = Column(Boolean, nullable=False, default=False)
    # Matches `sales.card_type`. NULL on the till and on plain accounts.
    card_type = Column(String(20), nullable=True)
    # The catch-all for non-cash money that carries no card type: a card
    # refund, a debt repaid by card, a mobile payment.
    is_other_noncash = Column(Boolean, nullable=False, default=False)
    # What the account held at `opening_at`. Everything recorded at or after
    # that moment is added on top; anything before it is considered already
    # included in this figure.
    opening_balance = Column(Numeric(14, 2), nullable=False, default=Decimal("0.00"))
    opening_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company")
    movements = relationship(
        "MoneyMovement", back_populates="account", cascade="all, delete-orphan"
    )


class MoneyMovement(Base):
    """One deliberate movement of money into or out of an account.

    Immutable by design. A mistake is corrected with an opposing movement, not
    by editing this row — an edited cash book is worth nothing to the person
    trying to work out where the money went.
    """

    __tablename__ = "money_movements"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_money_movements_amount_positive"),
        CheckConstraint(
            "direction IN ('in', 'out')", name="ck_money_movements_direction"
        ),
        Index("ix_money_movements_company_created", "company_id", "created_at"),
        Index("ix_money_movements_account_created", "account_id", "created_at"),
        Index("ix_money_movements_transfer_group", "transfer_group"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("money_accounts.id"), nullable=False)
    direction = Column(String(3), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    reason = Column(String(32), nullable=False)
    # Both legs of a transfer carry the same value, so the pair can be shown as
    # one line and neither can be read as money appearing from nowhere.
    transfer_group = Column(String(36), nullable=True)
    note = Column(String(500), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    account = relationship("MoneyAccount", back_populates="movements")
    created_by_user = relationship("User")
