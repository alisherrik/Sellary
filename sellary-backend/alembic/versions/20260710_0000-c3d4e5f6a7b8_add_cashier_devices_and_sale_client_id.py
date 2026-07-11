"""add cashier_devices table and sales.client_sale_id

C2: cashier_devices holds one opaque, sha256-hashed, revocable device token per
registered offline cashier device (1 active per shop). C3: sales.client_sale_id
is a nullable local-origin id with a partial unique index that dedupes offline
sales per company without constraining the existing NULL online rows.

Chains off the Railway-pinned live head b2c3d4e5f6a7. The dead 20260319_0001
head is intentionally left untouched (no alembic merge).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-10 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # C2 — cashier_devices
    op.create_table(
        "cashier_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cashier_devices_id", "cashier_devices", ["id"])
    op.create_index("ix_cashier_devices_company_id", "cashier_devices", ["company_id"])
    op.create_index(
        "ix_cashier_devices_device_id", "cashier_devices", ["device_id"], unique=True
    )
    op.create_index(
        "ix_cashier_devices_company_active",
        "cashier_devices",
        ["company_id", "is_active"],
    )

    # C3 — sales.client_sale_id + plain index + partial unique index.
    # NOTE: the sales table is small (retail POS); these DDLs are fast and taken
    # inside the migration transaction, so no CONCURRENTLY / long lock concern.
    op.add_column("sales", sa.Column("client_sale_id", sa.String(length=64), nullable=True))
    op.create_index("ix_sales_client_sale_id", "sales", ["client_sale_id"])
    op.create_index(
        "uq_sales_company_client_sale_id",
        "sales",
        ["company_id", "client_sale_id"],
        unique=True,
        postgresql_where=sa.text("client_sale_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_sales_company_client_sale_id", table_name="sales")
    op.drop_index("ix_sales_client_sale_id", table_name="sales")
    op.drop_column("sales", "client_sale_id")

    op.drop_index("ix_cashier_devices_company_active", table_name="cashier_devices")
    op.drop_index("ix_cashier_devices_device_id", table_name="cashier_devices")
    op.drop_index("ix_cashier_devices_company_id", table_name="cashier_devices")
    op.drop_index("ix_cashier_devices_id", table_name="cashier_devices")
    op.drop_table("cashier_devices")
