"""widen unit_cost / cost_price to 4 decimals

Lets wholesale purchase totals divide cleanly into a per-unit cost
(45 / 24 = 1.8750) instead of rounding to 2 decimals and leaving a remainder.

Revision ID: a1b2c3d4e5f6
Revises: 7e3f1c9a4b20
Create Date: 2026-06-17 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "7e3f1c9a4b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, column) pairs whose Numeric precision moves 2 -> 4 decimals.
_COST_COLUMNS = (
    ("purchase_order_items", "unit_cost"),
    ("purchase_receipt_items", "unit_cost"),
    ("inventory_layers", "unit_cost"),
    ("products", "cost_price"),
)


def upgrade() -> None:
    for table, column in _COST_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.Numeric(10, 2),
            type_=sa.Numeric(10, 4),
            existing_nullable=False,
        )


def downgrade() -> None:
    for table, column in _COST_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.Numeric(10, 4),
            type_=sa.Numeric(10, 2),
            existing_nullable=False,
        )
