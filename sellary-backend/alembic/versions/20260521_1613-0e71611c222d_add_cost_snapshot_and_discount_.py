"""add cost snapshot and discount allocation to sale_items

Revision ID: 0e71611c222d
Revises: fa6a1969421c
Create Date: 2026-05-21 16:13:09.814361

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '0e71611c222d'
down_revision: Union[str, None] = 'fa6a1969421c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    insp = inspect(conn)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _column_exists("sale_items", "allocated_sale_discount_amount"):
        op.add_column("sale_items", sa.Column("allocated_sale_discount_amount", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"))
    if not _column_exists("sale_items", "unit_cost_at_sale"):
        op.add_column("sale_items", sa.Column("unit_cost_at_sale", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"))
    if not _column_exists("sale_items", "cost_total_at_sale"):
        op.add_column("sale_items", sa.Column("cost_total_at_sale", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"))


def downgrade() -> None:
    if _column_exists("sale_items", "cost_total_at_sale"):
        op.drop_column("sale_items", "cost_total_at_sale")
    if _column_exists("sale_items", "unit_cost_at_sale"):
        op.drop_column("sale_items", "unit_cost_at_sale")
    if _column_exists("sale_items", "allocated_sale_discount_amount"):
        op.drop_column("sale_items", "allocated_sale_discount_amount")
    # ### end Alembic commands ###
