"""add transaction reversal ledger

Revision ID: 7e3f1c9a4b20
Revises: d6220dc5b3cb
Create Date: 2026-06-15 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7e3f1c9a4b20"
down_revision: Union[str, None] = "d6220dc5b3cb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM products WHERE stock_quantity < 0) THEN
                RAISE EXCEPTION 'Cannot enable inventory ledger while products have negative stock';
            END IF;
        END $$;
        """
    )

    op.add_column("companies", sa.Column("inventory_ledger_started_at", sa.DateTime(timezone=True)))
    op.add_column("products", sa.Column("inventory_value", sa.Numeric(16, 4)))
    op.add_column("inventory_logs", sa.Column("value_change", sa.Numeric(16, 4)))
    op.add_column("inventory_logs", sa.Column("reversal_operation_id", sa.Integer()))
    op.add_column("sales", sa.Column("voided_at", sa.DateTime(timezone=True)))
    op.add_column("sales", sa.Column("voided_by_user_id", sa.Integer()))
    op.add_column("sales", sa.Column("void_reason", sa.Text()))
    op.add_column("sales", sa.Column("reversal_operation_id", sa.Integer()))
    op.add_column("purchase_orders", sa.Column("voided_at", sa.DateTime(timezone=True)))
    op.add_column("purchase_orders", sa.Column("voided_by_user_id", sa.Integer()))
    op.add_column("purchase_orders", sa.Column("void_reason", sa.Text()))
    op.add_column("purchase_orders", sa.Column("reversal_operation_id", sa.Integer()))

    op.create_table(
        "reversal_operations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("operation_type", sa.String(50), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("impact", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index(
        "ix_reversal_operations_company_entity",
        "reversal_operations",
        ["company_id", "entity_type", "entity_id"],
    )

    op.create_foreign_key(
        "fk_inventory_logs_reversal_operation_id",
        "inventory_logs",
        "reversal_operations",
        ["reversal_operation_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_sales_voided_by_user_id", "sales", "users", ["voided_by_user_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_sales_reversal_operation_id",
        "sales",
        "reversal_operations",
        ["reversal_operation_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_purchase_orders_voided_by_user_id",
        "purchase_orders",
        "users",
        ["voided_by_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_purchase_orders_reversal_operation_id",
        "purchase_orders",
        "reversal_operations",
        ["reversal_operation_id"],
        ["id"],
    )

    op.create_table(
        "purchase_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("purchase_order_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("reversal_operation_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reversed_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reversal_operation_id"], ["reversal_operations.id"]),
    )
    op.create_index("ix_purchase_receipts_company_id", "purchase_receipts", ["company_id"])

    op.create_table(
        "purchase_receipt_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("purchase_receipt_id", sa.Integer(), nullable=False),
        sa.Column("purchase_order_item_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(10, 2), nullable=False),
        sa.ForeignKeyConstraint(["purchase_receipt_id"], ["purchase_receipts.id"]),
        sa.ForeignKeyConstraint(["purchase_order_item_id"], ["purchase_order_items.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
    )
    op.create_index(
        "ix_purchase_receipt_items_purchase_receipt_id",
        "purchase_receipt_items",
        ["purchase_receipt_id"],
    )

    op.create_table(
        "inventory_layers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("purchase_receipt_item_id", sa.Integer()),
        sa.Column("original_quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("remaining_quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(10, 2), nullable=False),
        sa.Column("reversal_operation_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reversed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("original_quantity >= 0", name="ck_inventory_layers_original_nonnegative"),
        sa.CheckConstraint("remaining_quantity >= 0", name="ck_inventory_layers_remaining_nonnegative"),
        sa.CheckConstraint(
            "remaining_quantity <= original_quantity",
            name="ck_inventory_layers_remaining_lte_original",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["purchase_receipt_item_id"], ["purchase_receipt_items.id"]),
        sa.ForeignKeyConstraint(["reversal_operation_id"], ["reversal_operations.id"]),
        sa.UniqueConstraint("purchase_receipt_item_id", name="uq_inventory_layers_purchase_receipt_item_id"),
    )
    op.create_index(
        "ix_inventory_layers_fifo",
        "inventory_layers",
        ["company_id", "product_id", "reversed_at", "created_at", "id"],
    )

    op.create_table(
        "inventory_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("layer_id", sa.Integer(), nullable=False),
        sa.Column("consumer_type", sa.String(50), nullable=False),
        sa.Column("consumer_id", sa.Integer(), nullable=False),
        sa.Column("sale_item_id", sa.Integer()),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("released_quantity", sa.Numeric(10, 3), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_allocations_quantity_positive"),
        sa.CheckConstraint("released_quantity >= 0", name="ck_inventory_allocations_released_nonnegative"),
        sa.CheckConstraint(
            "released_quantity <= quantity",
            name="ck_inventory_allocations_released_lte_quantity",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["layer_id"], ["inventory_layers.id"]),
        sa.ForeignKeyConstraint(["sale_item_id"], ["sale_items.id"]),
    )
    op.create_index(
        "ix_inventory_allocations_consumer",
        "inventory_allocations",
        ["company_id", "consumer_type", "consumer_id"],
    )

    op.execute("UPDATE products SET inventory_value = stock_quantity * cost_price")
    op.execute("UPDATE companies SET inventory_ledger_started_at = CURRENT_TIMESTAMP")
    op.execute("UPDATE inventory_logs SET value_change = 0")
    op.execute(
        """
        INSERT INTO inventory_layers (
            company_id, product_id, source_type, source_id,
            original_quantity, remaining_quantity, unit_cost, created_at
        )
        SELECT company_id, id, 'opening_balance', id,
               stock_quantity, stock_quantity, cost_price, CURRENT_TIMESTAMP
        FROM products
        WHERE stock_quantity > 0
        """
    )

    op.alter_column(
        "products",
        "inventory_value",
        existing_type=sa.Numeric(16, 4),
        nullable=False,
        server_default=sa.text("0.0000"),
    )
    op.alter_column(
        "inventory_logs",
        "value_change",
        existing_type=sa.Numeric(16, 4),
        nullable=False,
        server_default=sa.text("0.0000"),
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_allocations_consumer", table_name="inventory_allocations")
    op.drop_table("inventory_allocations")
    op.drop_index("ix_inventory_layers_fifo", table_name="inventory_layers")
    op.drop_table("inventory_layers")
    op.drop_index(
        "ix_purchase_receipt_items_purchase_receipt_id",
        table_name="purchase_receipt_items",
    )
    op.drop_table("purchase_receipt_items")
    op.drop_index("ix_purchase_receipts_company_id", table_name="purchase_receipts")
    op.drop_table("purchase_receipts")

    op.drop_constraint("fk_purchase_orders_reversal_operation_id", "purchase_orders", type_="foreignkey")
    op.drop_constraint("fk_purchase_orders_voided_by_user_id", "purchase_orders", type_="foreignkey")
    op.drop_constraint("fk_sales_reversal_operation_id", "sales", type_="foreignkey")
    op.drop_constraint("fk_sales_voided_by_user_id", "sales", type_="foreignkey")
    op.drop_constraint("fk_inventory_logs_reversal_operation_id", "inventory_logs", type_="foreignkey")
    op.drop_index("ix_reversal_operations_company_entity", table_name="reversal_operations")
    op.drop_table("reversal_operations")

    op.drop_column("purchase_orders", "reversal_operation_id")
    op.drop_column("purchase_orders", "void_reason")
    op.drop_column("purchase_orders", "voided_by_user_id")
    op.drop_column("purchase_orders", "voided_at")
    op.drop_column("sales", "reversal_operation_id")
    op.drop_column("sales", "void_reason")
    op.drop_column("sales", "voided_by_user_id")
    op.drop_column("sales", "voided_at")
    op.drop_column("inventory_logs", "reversal_operation_id")
    op.drop_column("inventory_logs", "value_change")
    op.drop_column("products", "inventory_value")
    op.drop_column("companies", "inventory_ledger_started_at")
