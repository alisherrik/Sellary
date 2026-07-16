"""widen sell_price / unit_price to 4 decimals

Mirrors a1b2c3d4e5f6, which widened the cost side (cost_price, unit_cost) to 4
decimals but left the sell side at 2. A unit price of 45 / 24 = 1.8750 could be
stored as a cost but not as a price, so the operator's entry was silently
rounded to 1.88.

sale_items.unit_price moves too: without it the widened catalogue price is
truncated again the moment the item is sold, and the historical line would
disagree with the product it was sold from.

Money TOTALS stay at 2 decimals — only the per-unit price gains precision.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-16 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, column) pairs whose Numeric precision moves 2 -> 4 decimals.
_PRICE_COLUMNS = (
    ("products", "sell_price"),
    ("product_units", "sell_price"),
    ("sale_items", "unit_price"),
)


def upgrade() -> None:
    for table, column in _PRICE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.Numeric(10, 2),
            type_=sa.Numeric(10, 4),
            existing_nullable=False,
        )


def downgrade() -> None:
    # Narrowing rounds any stored 3rd/4th decimal away — Postgres does this
    # silently, so a downgrade is lossy for prices entered after the upgrade.
    for table, column in _PRICE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.Numeric(10, 4),
            type_=sa.Numeric(10, 2),
            existing_nullable=False,
        )
