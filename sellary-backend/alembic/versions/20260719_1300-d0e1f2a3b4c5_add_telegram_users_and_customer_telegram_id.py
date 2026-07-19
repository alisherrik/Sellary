"""add telegram_users table and customers.telegram_id

F2 (marketplace public catalog + Telegram identity). telegram_users is the
global, login-less shopper identity keyed by a verified Telegram user id.
customers.telegram_id links a per-shop Customer to that global shopper; it is
nullable (web/POS-created customers have none) and a partial unique index
dedupes it per company while leaving NULLs unconstrained — mirroring the
client_customer_id pattern. Chains off the F1 head c9d0e1f2a3b4; the dead
20260319_0001 head is intentionally left untouched (no alembic merge).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-19 13:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telegram_users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("first_name", sa.String(length=150), nullable=True),
        sa.Column("username", sa.String(length=150), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_telegram_users_telegram_id",
        "telegram_users",
        ["telegram_id"],
        unique=True,
    )

    # Small table (retail POS); DDL is fast and taken inside the migration
    # transaction, so no CONCURRENTLY / long-lock concern.
    op.add_column(
        "customers", sa.Column("telegram_id", sa.BigInteger(), nullable=True)
    )
    op.create_index(
        "ix_customers_telegram_id", "customers", ["telegram_id"]
    )
    op.create_index(
        "uq_customers_company_telegram_id",
        "customers",
        ["company_id", "telegram_id"],
        unique=True,
        postgresql_where=sa.text("telegram_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_customers_company_telegram_id", table_name="customers")
    op.drop_index("ix_customers_telegram_id", table_name="customers")
    op.drop_column("customers", "telegram_id")
    op.drop_index("ix_telegram_users_telegram_id", table_name="telegram_users")
    op.drop_table("telegram_users")
