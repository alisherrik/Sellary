"""record a reconciliation as a document, not a column

A shop that has counted every product and every account on one day wants the
figures before that day left alone. That is an act with a date, an author and a
note — a document — so it is a row and not a flag: the next reconciliation is
the next row, and the history says who settled what and when.

`effective_from` is the first local day that is still OPEN. Everything strictly
before local midnight of it is settled. Storing the open day rather than the
counted one means the comparison is the same one the reports already make —
"does this instant fall on or after this day" — with no off-by-one to carry.

Drops `companies.inventory_ledger_started_at`: a per-company cut-off timestamp
read by no application code, which is exactly the decay a second cut-off would
have grown into.

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-08-13 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_reconciliations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        # The checker's findings at the moment of the freeze: empty when clean,
        # populated when an admin knowingly reconciled over drift.
        sa.Column("checker_report", sa.JSON(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_company_reconciliations_company_id"),
        "company_reconciliations",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        "ix_company_reconciliations_company_effective",
        "company_reconciliations",
        ["company_id", "effective_from"],
        unique=False,
    )

    op.drop_column("companies", "inventory_ledger_started_at")


def downgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("inventory_ledger_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_index("ix_company_reconciliations_company_effective", table_name="company_reconciliations")
    op.drop_index(
        op.f("ix_company_reconciliations_company_id"), table_name="company_reconciliations"
    )
    op.drop_table("company_reconciliations")
