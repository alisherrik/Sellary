"""add company_modules and split pos into register/sales/customers

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-07-25 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, None] = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None

# Every existing company keeps everything it had. `shop` is conditional
# because it was already gated by is_marketplace_enabled.
BASE_MODULES = ("register", "sales", "customers", "inventory", "purchasing", "reports")

# The three domains that used to live behind the single `pos` key.
POS_SPLIT = ("register", "sales", "customers")

LEVEL_RANK = {"user": 1, "manager": 2}


def upgrade() -> None:
    op.add_column("companies", sa.Column("business_type", sa.String(length=30), nullable=True))

    op.create_table(
        "company_modules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("module", sa.String(length=20), nullable=False),
        sa.Column(
            "enabled_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "company_id", "module", name="uq_company_modules_company_module"
        ),
    )

    conn = op.get_bind()

    # 1. Company-level backfill: nobody loses a screen they had yesterday.
    companies = conn.execute(
        sa.text("SELECT id, is_marketplace_enabled FROM companies")
    ).fetchall()
    company_rows = []
    for company_id, marketplace_enabled in companies:
        for module in BASE_MODULES:
            company_rows.append({"company_id": company_id, "module": module})
        if marketplace_enabled:
            company_rows.append({"company_id": company_id, "module": "shop"})
    if company_rows:
        conn.execute(
            sa.text(
                "INSERT INTO company_modules (company_id, module) "
                "VALUES (:company_id, :module)"
            ),
            company_rows,
        )

    # 2. Membership-level split: pos -> register + sales + customers, same level.
    pos_grants = conn.execute(
        sa.text(
            "SELECT membership_id, level FROM membership_module_access "
            "WHERE module = 'pos'"
        )
    ).fetchall()
    split_rows = [
        {"membership_id": membership_id, "module": module, "level": level}
        for membership_id, level in pos_grants
        for module in POS_SPLIT
    ]
    if split_rows:
        conn.execute(
            sa.text(
                "INSERT INTO membership_module_access (membership_id, module, level) "
                "VALUES (:membership_id, :module, :level) "
                "ON CONFLICT (membership_id, module) DO NOTHING"
            ),
            split_rows,
        )
    conn.execute(sa.text("DELETE FROM membership_module_access WHERE module = 'pos'"))


def downgrade() -> None:
    conn = op.get_bind()

    # Collapse the three back into one `pos` grant at the highest level held.
    grants = conn.execute(
        sa.text(
            "SELECT membership_id, module, level FROM membership_module_access "
            "WHERE module IN ('register', 'sales', 'customers')"
        )
    ).fetchall()
    best: dict[int, str] = {}
    for membership_id, _module, level in grants:
        current = best.get(membership_id)
        if current is None or LEVEL_RANK[level] > LEVEL_RANK[current]:
            best[membership_id] = level
    conn.execute(
        sa.text(
            "DELETE FROM membership_module_access "
            "WHERE module IN ('register', 'sales', 'customers')"
        )
    )
    if best:
        conn.execute(
            sa.text(
                "INSERT INTO membership_module_access (membership_id, module, level) "
                "VALUES (:membership_id, 'pos', :level) "
                "ON CONFLICT (membership_id, module) DO NOTHING"
            ),
            [
                {"membership_id": membership_id, "level": level}
                for membership_id, level in best.items()
            ],
        )

    op.drop_table("company_modules")
    op.drop_column("companies", "business_type")
