"""add companies.timezone

Reports computed "today" from the server clock, which runs UTC. The shops run
at UTC+5, so every sale rung between local 00:00 and 05:00 was reported against
the previous day — 12.5% of production sales at the time of writing.

Per-company rather than a global setting: the system is multi-tenant, and a
tenant in another region should not require a second migration.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-16 10:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column(
            "timezone",
            sa.String(64),
            nullable=False,
            server_default="Asia/Dushanbe",
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "timezone")
