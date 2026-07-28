"""take spoiled goods off the shelf as a document

Spoilage, breakage and factory defects left stock through a single-product
quantity nudge whose reason was free text, so nothing could be grouped and a
disposal was indistinguishable from goods handed back to the supplier.

Header plus lines, the shape purchase orders and sales already use. Cost is
whatever the FIFO ledger consumed, frozen into the row.

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-07-28 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c6d7e8f9a0b1"
down_revision: Union[str, None] = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_write_offs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        # String, not a native enum: Postgres rejects an unknown enum value at
        # runtime while SQLite waves it through in tests. Validation is in the
        # schema layer.
        sa.Column("disposition", sa.String(length=24), nullable=False),
        sa.Column("reason_code", sa.String(length=24), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "total_cost",
            sa.Numeric(precision=16, scale=4),
            nullable=False,
            server_default="0.0000",
        ),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_stock_write_offs_id"), "stock_write_offs", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_stock_write_offs_company_id"),
        "stock_write_offs",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_stock_write_offs_created_at"),
        "stock_write_offs",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_stock_write_offs_company_created",
        "stock_write_offs",
        ["company_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "stock_write_off_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("write_off_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("product_unit_id", sa.Integer(), nullable=True),
        sa.Column("unit_quantity", sa.Numeric(precision=12, scale=3), nullable=False),
        # Base units, like sale_items.quantity.
        sa.Column("quantity", sa.Numeric(precision=10, scale=3), nullable=False),
        sa.Column(
            "unit_cost",
            sa.Numeric(precision=16, scale=4),
            nullable=False,
            server_default="0.0000",
        ),
        sa.Column(
            "line_cost",
            sa.Numeric(precision=16, scale=4),
            nullable=False,
            server_default="0.0000",
        ),
        sa.ForeignKeyConstraint(["write_off_id"], ["stock_write_offs.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["product_unit_id"], ["product_units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_stock_write_off_items_id"),
        "stock_write_off_items",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_stock_write_off_items_write_off_id"),
        "stock_write_off_items",
        ["write_off_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_stock_write_off_items_write_off_id"),
        table_name="stock_write_off_items",
    )
    op.drop_index(
        op.f("ix_stock_write_off_items_id"), table_name="stock_write_off_items"
    )
    op.drop_table("stock_write_off_items")

    op.drop_index("ix_stock_write_offs_company_created", table_name="stock_write_offs")
    op.drop_index(op.f("ix_stock_write_offs_created_at"), table_name="stock_write_offs")
    op.drop_index(op.f("ix_stock_write_offs_company_id"), table_name="stock_write_offs")
    op.drop_index(op.f("ix_stock_write_offs_id"), table_name="stock_write_offs")
    op.drop_table("stock_write_offs")
