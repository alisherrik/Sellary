"""add customers.client_customer_id

C1 (offline credit): customers.client_customer_id is a nullable local-origin id
from the offline cashier. A partial unique index dedupes offline-created
customers per company while leaving the existing NULL (web-created) rows
unconstrained. Chains off the Phase-1 head c3d4e5f6a7b8; the dead 20260319_0001
head is intentionally left untouched (no alembic merge).

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-11 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Small table (retail POS); DDL is fast and taken inside the migration
    # transaction, so no CONCURRENTLY / long-lock concern.
    op.add_column(
        "customers",
        sa.Column("client_customer_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_customers_client_customer_id",
        "customers",
        ["client_customer_id"],
    )
    op.create_index(
        "uq_customers_company_client_customer_id",
        "customers",
        ["company_id", "client_customer_id"],
        unique=True,
        postgresql_where=sa.text("client_customer_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_customers_company_client_customer_id", table_name="customers"
    )
    op.drop_index("ix_customers_client_customer_id", table_name="customers")
    op.drop_column("customers", "client_customer_id")
