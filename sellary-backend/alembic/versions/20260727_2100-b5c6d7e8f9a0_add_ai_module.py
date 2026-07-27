"""make the AI connector a module a company can switch off

The MCP connector hands a third party a live door into a company's data. It
belongs behind the same switch every other domain sits behind, so an owner can
close it — and closing it has to work immediately, including for tokens that
were already issued.

Turned on only for companies that have actually authorised an MCP client. A
working connector must not die on deploy, and a company that never opened the
door does not get it opened for them.

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-07-27 21:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b5c6d7e8f9a0"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            INSERT INTO company_modules (company_id, module)
            SELECT DISTINCT company_id, 'ai'
            FROM oauth_refresh_tokens
            WHERE revoked_at IS NULL
            ON CONFLICT (company_id, module) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text("DELETE FROM company_modules WHERE module = 'ai'")
    )
