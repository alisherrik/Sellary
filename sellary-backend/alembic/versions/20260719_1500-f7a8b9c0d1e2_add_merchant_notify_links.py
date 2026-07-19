"""add merchant_notify_links table (F6 bot notifications)

Revision ID: f7a8b9c0d1e2
Revises: e1f2a3b4c5d6
Create Date: 2026-07-19 15:00:00
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "merchant_notify_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("telegram_chat_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("company_id", "telegram_chat_id",
                            name="uq_merchant_notify_company_chat"),
    )
    op.create_index("ix_merchant_notify_company_id", "merchant_notify_links", ["company_id"])


def downgrade() -> None:
    op.drop_index("ix_merchant_notify_company_id", table_name="merchant_notify_links")
    op.drop_table("merchant_notify_links")
