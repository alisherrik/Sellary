"""add_uom_decimal_quantities

Revision ID: fa6a1969421c
Revises: 743f7fdacfb2
Create Date: 2026-05-18 18:09:27.286693

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa6a1969421c'
down_revision: Union[str, None] = '743f7fdacfb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add uom column to products
    op.add_column(
        "products",
        sa.Column("uom", sa.String(20), nullable=False, server_default="dona"),
    )

    # 2. Alter all integer quantity columns to Numeric(10,3)
    op.execute(
        "ALTER TABLE products ALTER COLUMN stock_quantity TYPE NUMERIC(10,3) "
        "USING stock_quantity::NUMERIC(10,3)"
    )
    op.execute(
        "ALTER TABLE products ALTER COLUMN min_stock_level TYPE NUMERIC(10,3) "
        "USING min_stock_level::NUMERIC(10,3)"
    )

    op.execute(
        "ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(10,3) "
        "USING quantity::NUMERIC(10,3)"
    )
    op.execute(
        "ALTER TABLE sale_items ALTER COLUMN quantity_returned TYPE NUMERIC(10,3) "
        "USING quantity_returned::NUMERIC(10,3)"
    )

    op.execute(
        "ALTER TABLE purchase_order_items ALTER COLUMN quantity_ordered TYPE NUMERIC(10,3) "
        "USING quantity_ordered::NUMERIC(10,3)"
    )
    op.execute(
        "ALTER TABLE purchase_order_items ALTER COLUMN quantity_received TYPE NUMERIC(10,3) "
        "USING quantity_received::NUMERIC(10,3)"
    )

    op.execute(
        "ALTER TABLE inventory_logs ALTER COLUMN quantity_change TYPE NUMERIC(10,3) "
        "USING quantity_change::NUMERIC(10,3)"
    )
    op.execute(
        "ALTER TABLE inventory_logs ALTER COLUMN previous_quantity TYPE NUMERIC(10,3) "
        "USING previous_quantity::NUMERIC(10,3)"
    )
    op.execute(
        "ALTER TABLE inventory_logs ALTER COLUMN new_quantity TYPE NUMERIC(10,3) "
        "USING new_quantity::NUMERIC(10,3)"
    )

    op.execute(
        "ALTER TABLE sale_return_items ALTER COLUMN quantity_returned TYPE NUMERIC(10,3) "
        "USING quantity_returned::NUMERIC(10,3)"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE products ALTER COLUMN stock_quantity TYPE INTEGER "
        "USING stock_quantity::INTEGER"
    )
    op.execute(
        "ALTER TABLE products ALTER COLUMN min_stock_level TYPE INTEGER "
        "USING min_stock_level::INTEGER"
    )

    op.execute(
        "ALTER TABLE sale_items ALTER COLUMN quantity TYPE INTEGER "
        "USING quantity::INTEGER"
    )
    op.execute(
        "ALTER TABLE sale_items ALTER COLUMN quantity_returned TYPE INTEGER "
        "USING quantity_returned::INTEGER"
    )

    op.execute(
        "ALTER TABLE purchase_order_items ALTER COLUMN quantity_ordered TYPE INTEGER "
        "USING quantity_ordered::INTEGER"
    )
    op.execute(
        "ALTER TABLE purchase_order_items ALTER COLUMN quantity_received TYPE INTEGER "
        "USING quantity_received::INTEGER"
    )

    op.execute(
        "ALTER TABLE inventory_logs ALTER COLUMN quantity_change TYPE INTEGER "
        "USING quantity_change::INTEGER"
    )
    op.execute(
        "ALTER TABLE inventory_logs ALTER COLUMN previous_quantity TYPE INTEGER "
        "USING previous_quantity::INTEGER"
    )
    op.execute(
        "ALTER TABLE inventory_logs ALTER COLUMN new_quantity TYPE INTEGER "
        "USING new_quantity::INTEGER"
    )

    op.execute(
        "ALTER TABLE sale_return_items ALTER COLUMN quantity_returned TYPE INTEGER "
        "USING quantity_returned::INTEGER"
    )

    op.drop_column("products", "uom")
