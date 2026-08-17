"""add cash_shifts.opening_notes

A cashier can already leave a note when closing a shift (`notes`). Opening had
nowhere to put one, so a comment made at handover — "касса без сдачи", a
missing till key, whatever explains the count — had no home. A separate
column, not a reuse of `notes`: that one is written only at close, and sharing
it would let closing silently erase what was said at opening.

Revision ID: 3de347509835
Revises: e8f9a0b1c2d3
Create Date: 2026-08-17 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "3de347509835"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cash_shifts", sa.Column("opening_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("cash_shifts", "opening_notes")
