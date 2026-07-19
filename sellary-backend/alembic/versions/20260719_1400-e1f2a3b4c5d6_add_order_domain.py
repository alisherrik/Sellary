"""add orders and order_items tables (F4 Order domain)

Creates the Order domain for the marketplace checkout flow. `orders` is a
company-scoped record capturing shopper intent (telegram_user_id, optional
customer_id, fulfillment_type, contact details, totals, and an optional link
back to a finalized `sales` record). `order_items` stores per-line snapshots of
product_name and unit_price so the order history remains accurate even after
catalog edits. Both status and fulfillment_type are stored as plain VARCHAR to
avoid native Postgres enums and the painful ALTER TABLE migrations they require.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-07-19 14:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id"),
            nullable=False,
        ),
        sa.Column(
            "telegram_user_id",
            sa.Integer(),
            sa.ForeignKey("telegram_users.id"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            sa.Integer(),
            sa.ForeignKey("customers.id"),
            nullable=True,
        ),
        sa.Column("order_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("fulfillment_type", sa.String(), nullable=False),
        sa.Column("delivery_address", sa.Text(), nullable=True),
        sa.Column("contact_phone", sa.String(length=32), nullable=False),
        sa.Column("contact_name", sa.String(length=150), nullable=False),
        sa.Column(
            "subtotal",
            sa.Numeric(precision=12, scale=2),
            nullable=False,
        ),
        sa.Column(
            "total_amount",
            sa.Numeric(precision=12, scale=2),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "sale_id",
            sa.Integer(),
            sa.ForeignKey("sales.id"),
            nullable=True,
        ),
        sa.Column("checkout_group_id", sa.String(length=36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_orders_company_id", "orders", ["company_id"])
    op.create_index("ix_orders_telegram_user_id", "orders", ["telegram_user_id"])
    op.create_index("ix_orders_status", "orders", ["status"])

    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("products.id"),
            nullable=False,
        ),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column(
            "unit_price",
            sa.Numeric(precision=12, scale=4),
            nullable=False,
        ),
        sa.Column(
            "quantity",
            sa.Numeric(precision=12, scale=3),
            nullable=False,
        ),
        sa.Column(
            "line_total",
            sa.Numeric(precision=12, scale=2),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("order_items")
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_index("ix_orders_telegram_user_id", table_name="orders")
    op.drop_index("ix_orders_company_id", table_name="orders")
    op.drop_table("orders")
