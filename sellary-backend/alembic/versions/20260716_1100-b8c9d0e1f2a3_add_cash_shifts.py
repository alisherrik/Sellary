"""add cash_shifts and cash_shift_snapshots

Cashier till sessions (смена кассы). A shift is a time window — sales, refunds
and debt repayments belong to it by timestamp, so `sales` needs no shift_id.
Totals are frozen onto the row at close.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-16 11:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cash_shifts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("shift_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("open", "closed", name="cashshiftstatus"),
            nullable=False,
        ),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("opened_by_user_id", sa.Integer(), nullable=False),
        sa.Column("opening_cash", sa.Numeric(12, 2), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("counted_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("discrepancy", sa.Numeric(12, 2), nullable=True),
        sa.Column("closing_totals", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["opened_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_cash_shifts_company_id"), "cash_shifts", ["company_id"])
    op.create_index(op.f("ix_cash_shifts_status"), "cash_shifts", ["status"])
    # At most one open shift per company, enforced by the DB.
    op.create_index(
        "uq_cash_shifts_one_open_per_company",
        "cash_shifts",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )

    op.create_table(
        "cash_shift_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("shift_id", sa.Integer(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("taken_by_user_id", sa.Integer(), nullable=False),
        sa.Column("totals", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["shift_id"], ["cash_shifts.id"]),
        sa.ForeignKeyConstraint(["taken_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_cash_shift_snapshots_company_id"), "cash_shift_snapshots", ["company_id"])
    op.create_index(op.f("ix_cash_shift_snapshots_shift_id"), "cash_shift_snapshots", ["shift_id"])


def downgrade() -> None:
    op.drop_table("cash_shift_snapshots")
    op.drop_index("uq_cash_shifts_one_open_per_company", table_name="cash_shifts")
    op.drop_index(op.f("ix_cash_shifts_status"), table_name="cash_shifts")
    op.drop_index(op.f("ix_cash_shifts_company_id"), table_name="cash_shifts")
    op.drop_table("cash_shifts")
    sa.Enum(name="cashshiftstatus").drop(op.get_bind(), checkfirst=True)
