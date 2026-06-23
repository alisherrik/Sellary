"""add product_units and sale_item sold-unit columns

Lets one product be sold in multiple units of measure (e.g. rice by kg, by sack,
by 300 g portion). The product's own uom/sell_price stay the BASE unit
(factor 1); product_units holds additional sellable units, each with its own
price and a conversion factor to the base unit. sale_items records what was sold
in the chosen unit while `quantity` stays in base units for the FIFO ledger.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-23 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_units",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=20), nullable=False),
        sa.Column("factor", sa.Numeric(12, 4), nullable=False),
        sa.Column("sell_price", sa.Numeric(10, 2), nullable=False),
        sa.Column("barcode", sa.String(length=50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_product_units_id", "product_units", ["id"])
    op.create_index("ix_product_units_product_id", "product_units", ["product_id"])

    # sale_items: record the unit the cashier actually sold in. `quantity` stays
    # in base units for the FIFO ledger; these columns are for display/receipts.
    op.add_column("sale_items", sa.Column("product_unit_id", sa.Integer(), nullable=True))
    op.add_column(
        "sale_items",
        sa.Column("sold_quantity", sa.Numeric(10, 3), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("sale_items", sa.Column("sold_unit_label", sa.String(length=20), nullable=True))
    op.add_column(
        "sale_items",
        sa.Column("sold_unit_factor", sa.Numeric(12, 4), nullable=False, server_default=sa.text("1")),
    )
    op.create_foreign_key(
        "fk_sale_items_product_unit_id",
        "sale_items",
        "product_units",
        ["product_unit_id"],
        ["id"],
    )

    # Backfill existing rows: every prior sale was made in the base unit.
    op.execute(
        """
        UPDATE sale_items AS si
        SET sold_quantity = si.quantity,
            sold_unit_factor = 1,
            sold_unit_label = p.uom
        FROM products AS p
        WHERE si.product_id = p.id
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_sale_items_product_unit_id", "sale_items", type_="foreignkey")
    op.drop_column("sale_items", "sold_unit_factor")
    op.drop_column("sale_items", "sold_unit_label")
    op.drop_column("sale_items", "sold_quantity")
    op.drop_column("sale_items", "product_unit_id")
    op.drop_index("ix_product_units_product_id", table_name="product_units")
    op.drop_index("ix_product_units_id", table_name="product_units")
    op.drop_table("product_units")
