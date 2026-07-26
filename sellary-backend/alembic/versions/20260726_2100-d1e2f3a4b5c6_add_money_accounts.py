"""add money_accounts and money_movements, plus the finance module

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-07-26 21:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None

CARD_LABELS = {"dc": "DC", "eskhata": "Эсхата", "alif": "Alif"}


def upgrade() -> None:
    op.create_table(
        "money_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("is_till", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("card_type", sa.String(length=20), nullable=True),
        sa.Column(
            "is_other_noncash", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "opening_balance",
            sa.Numeric(14, 2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column(
            "opening_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "uq_money_accounts_one_till_per_company",
        "money_accounts",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("is_till"),
        sqlite_where=sa.text("is_till"),
    )
    op.create_index(
        "uq_money_accounts_company_card_type",
        "money_accounts",
        ["company_id", "card_type"],
        unique=True,
        postgresql_where=sa.text("card_type IS NOT NULL"),
        sqlite_where=sa.text("card_type IS NOT NULL"),
    )
    op.create_index(
        "uq_money_accounts_one_other_noncash",
        "money_accounts",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("is_other_noncash"),
        sqlite_where=sa.text("is_other_noncash"),
    )
    op.create_index(
        "ix_money_accounts_company_sort", "money_accounts", ["company_id", "sort_order"]
    )

    op.create_table(
        "money_movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("money_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("direction", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("transfer_group", sa.String(length=36), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_money_movements_amount_positive"),
        sa.CheckConstraint(
            "direction IN ('in', 'out')", name="ck_money_movements_direction"
        ),
    )
    op.create_index(
        "ix_money_movements_company_created", "money_movements", ["company_id", "created_at"]
    )
    op.create_index(
        "ix_money_movements_account_created", "money_movements", ["account_id", "created_at"]
    )
    op.create_index(
        "ix_money_movements_transfer_group", "money_movements", ["transfer_group"]
    )

    conn = op.get_bind()
    companies = conn.execute(sa.text("SELECT id, created_at FROM companies")).fetchall()

    for company_id, company_created_at in companies:
        # The till starts where the company's first shift said the drawer
        # stood. Anchoring on 0 instead would make every cash sale ever
        # recorded look like growth from an empty drawer.
        first_shift = conn.execute(
            sa.text(
                "SELECT opening_cash, opened_at FROM cash_shifts "
                "WHERE company_id = :cid ORDER BY opened_at LIMIT 1"
            ),
            {"cid": company_id},
        ).fetchone()
        if first_shift:
            till_balance, till_at = first_shift
        else:
            till_balance, till_at = 0, company_created_at

        conn.execute(
            sa.text(
                "INSERT INTO money_accounts "
                "(company_id, name, is_till, card_type, is_other_noncash, opening_balance,"
                " opening_at, is_active, sort_order) "
                "VALUES (:cid, :name, true, NULL, false, :bal, :at, true, 0)"
            ),
            {"cid": company_id, "name": "Касса", "bal": till_balance, "at": till_at},
        )

        # One bank account per card type the company has actually taken money
        # on. Opening at the company's creation means every card sale on record
        # counts toward it — gross takings with nothing withdrawn yet, which
        # overstates the bank until the owner records the withdrawals. That is
        # visible and correctable; a silently invented balance would not be.
        card_types = conn.execute(
            sa.text(
                "SELECT DISTINCT card_type FROM sales "
                "WHERE company_id = :cid AND card_type IS NOT NULL"
            ),
            {"cid": company_id},
        ).fetchall()
        for index, (card_type,) in enumerate(sorted(card_types), start=1):
            conn.execute(
                sa.text(
                    "INSERT INTO money_accounts "
                    "(company_id, name, is_till, card_type, is_other_noncash, opening_balance,"
                    " opening_at, is_active, sort_order) "
                    "VALUES (:cid, :name, false, :ct, false, 0, :at, true, :sort)"
                ),
                {
                    "cid": company_id,
                    "name": f"Банк · {CARD_LABELS.get(card_type, card_type)}",
                    "ct": card_type,
                    "at": company_created_at,
                    "sort": index,
                },
            )

    # Nobody loses a screen: every existing company gets `finance`.
    conn.execute(
        sa.text(
            "INSERT INTO company_modules (company_id, module) "
            "SELECT id, 'finance' FROM companies "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM company_modules m "
            "  WHERE m.company_id = companies.id AND m.module = 'finance')"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM company_modules WHERE module = 'finance'"))
    conn.execute(
        sa.text("DELETE FROM membership_module_access WHERE module = 'finance'")
    )
    op.drop_index("ix_money_movements_transfer_group", table_name="money_movements")
    op.drop_index("ix_money_movements_account_created", table_name="money_movements")
    op.drop_index("ix_money_movements_company_created", table_name="money_movements")
    op.drop_table("money_movements")
    op.drop_index("ix_money_accounts_company_sort", table_name="money_accounts")
    op.drop_index("uq_money_accounts_one_other_noncash", table_name="money_accounts")
    op.drop_index("uq_money_accounts_company_card_type", table_name="money_accounts")
    op.drop_index("uq_money_accounts_one_till_per_company", table_name="money_accounts")
    op.drop_table("money_accounts")
