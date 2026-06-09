"""Add global role to users

Revision ID: 20260319_0001
Revises: 20260318_0000
Create Date: 2026-03-19 00:01:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260319_0001"
down_revision = "20260318_0000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "global_role",
            sa.String(length=20),
            nullable=False,
            server_default="standard",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "global_role")
