"""add purchase order item void (line-level annulment) audit fields

Adds per-line annulment audit columns to ``purchase_order_items`` so a single
received purchase line can be reversed without touching sibling lines. The
ordered/received quantities and subtotal stay unchanged for audit; these
columns record who reversed the line, when, why, and which reversal operation
performed it.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-11 01:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "purchase_order_items",
        sa.Column("voided_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "purchase_order_items",
        sa.Column("voided_by_user_id", sa.Integer()),
    )
    op.add_column(
        "purchase_order_items",
        sa.Column("void_reason", sa.Text()),
    )
    op.add_column(
        "purchase_order_items",
        sa.Column("reversal_operation_id", sa.Integer()),
    )
    op.create_foreign_key(
        "fk_purchase_order_items_voided_by_user_id",
        "purchase_order_items",
        "users",
        ["voided_by_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_purchase_order_items_reversal_operation_id",
        "purchase_order_items",
        "reversal_operations",
        ["reversal_operation_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_purchase_order_items_reversal_operation_id",
        "purchase_order_items",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_purchase_order_items_voided_by_user_id",
        "purchase_order_items",
        type_="foreignkey",
    )
    op.drop_column("purchase_order_items", "reversal_operation_id")
    op.drop_column("purchase_order_items", "void_reason")
    op.drop_column("purchase_order_items", "voided_by_user_id")
    op.drop_column("purchase_order_items", "voided_at")
