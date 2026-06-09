"""Add multi-company foundation

Revision ID: 20260318_0000
Revises: 20260201_0000
Create Date: 2026-03-18 00:00:00.000000

This migration is intended for the multi-company v1 rollout.
It creates companies and memberships, backfills existing single-company rows
into a default company, and scopes tenant-owned tables by company_id.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = "20260318_0000"
down_revision = "20260201_0000"
branch_labels = None
depends_on = None


TENANT_TABLES = [
    "categories",
    "customers",
    "products",
    "suppliers",
    "purchase_orders",
    "sales",
    "sale_returns",
    "inventory_logs",
    "idempotency_keys",
]


def _add_company_column(table_name: str) -> None:
    op.add_column(table_name, sa.Column("company_id", sa.Integer(), nullable=True))
    op.create_index(f"ix_{table_name}_company_id", table_name, ["company_id"])
    op.create_foreign_key(
        f"fk_{table_name}_company_id_companies",
        table_name,
        "companies",
        ["company_id"],
        ["id"],
    )


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("slug", sa.String(length=150), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_companies_id", "companies", ["id"], unique=False)
    op.create_index("ix_companies_slug", "companies", ["slug"], unique=True)

    op.create_table(
        "company_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="cashier"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.UniqueConstraint("user_id", "company_id", name="uq_company_membership_user_company"),
    )
    op.create_index("ix_company_memberships_id", "company_memberships", ["id"], unique=False)
    op.create_index("ix_company_memberships_user_id", "company_memberships", ["user_id"], unique=False)
    op.create_index("ix_company_memberships_company_id", "company_memberships", ["company_id"], unique=False)

    bind = op.get_bind()
    default_company_id = bind.execute(
        text(
            """
            INSERT INTO companies (name, slug, is_active)
            VALUES ('Default Company', 'default-company', true)
            RETURNING id
            """
        )
    ).scalar_one()

    for table_name in TENANT_TABLES:
        _add_company_column(table_name)
        bind.execute(
            text(f"UPDATE {table_name} SET company_id = :company_id WHERE company_id IS NULL"),
            {"company_id": default_company_id},
        )
        op.alter_column(table_name, "company_id", nullable=False)

    bind.execute(
        text(
            """
            INSERT INTO company_memberships (user_id, company_id, role, is_default, is_active)
            SELECT id, :company_id, COALESCE(role, 'cashier'), true, COALESCE(is_active, true)
            FROM users
            ON CONFLICT (user_id, company_id) DO NOTHING
            """
        ),
        {"company_id": default_company_id},
    )

    with op.batch_alter_table("categories") as batch_op:
        batch_op.create_unique_constraint("uq_categories_company_name", ["company_id", "name"])

    with op.batch_alter_table("customers") as batch_op:
        batch_op.create_unique_constraint("uq_customers_company_phone", ["company_id", "phone"])

    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key")
    with op.batch_alter_table("products") as batch_op:
        batch_op.create_unique_constraint("uq_products_company_barcode", ["company_id", "barcode"])

    op.drop_index("ix_idempotency_key_user_endpoint", table_name="idempotency_keys")
    op.create_index(
        "ix_idempotency_key_company_user_endpoint",
        "idempotency_keys",
        ["key", "company_id", "user_id", "endpoint"],
        unique=True,
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade is not supported for the multi-company foundation migration."
    )
