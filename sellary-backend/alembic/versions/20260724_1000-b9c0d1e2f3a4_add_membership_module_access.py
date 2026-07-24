"""add membership_module_access

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-07-24 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b9c0d1e2f3a4"
down_revision: Union[str, None] = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None

MODULES = ("pos", "inventory", "purchasing", "shop", "reports")


def upgrade() -> None:
    op.create_table(
        "membership_module_access",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "membership_id",
            sa.Integer(),
            sa.ForeignKey("company_memberships.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("module", sa.String(length=20), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "membership_id", "module", name="uq_module_access_membership_module"
        ),
    )

    # Backfill so existing companies keep working:
    #   manager  -> all 5 modules at manager
    #   cashier / any other non-admin role -> pos at user
    #   admin    -> nothing (bypasses checks)
    conn = op.get_bind()
    memberships = conn.execute(
        sa.text("SELECT id, role FROM company_memberships WHERE is_active = true")
    ).fetchall()
    rows = []
    for m_id, role in memberships:
        if role == "admin":
            continue
        if role == "manager":
            rows.extend(
                {"membership_id": m_id, "module": mod, "level": "manager"}
                for mod in MODULES
            )
        else:
            rows.append({"membership_id": m_id, "module": "pos", "level": "user"})
    if rows:
        conn.execute(
            sa.text(
                "INSERT INTO membership_module_access (membership_id, module, level) "
                "VALUES (:membership_id, :module, :level)"
            ),
            rows,
        )


def downgrade() -> None:
    op.drop_table("membership_module_access")
