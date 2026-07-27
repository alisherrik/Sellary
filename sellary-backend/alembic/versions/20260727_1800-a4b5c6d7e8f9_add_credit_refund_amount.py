"""record how much of a return was written off a debt rather than paid out

A return did two independent things: it reduced the customer's outstanding
debt by up to the refunded amount, and it recorded the whole refunded amount
as money leaving the till. Nothing compared the two, so a return against a
sale that still owed money both cancelled the debt and handed the cash over.

This column is the link. `credit_refund_amount` is the part settled against
the debt; the money that actually left is `total_refund_amount` minus it.

Existing rows get 0. Those are accurate accounts of what really happened — if
50 in cash did leave the drawer, the balance being 50 lighter is correct, and
rewriting history would move figures the owner has already reconciled against.

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-07-27 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sale_returns",
        sa.Column(
            "credit_refund_amount",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="0.00",
        ),
    )


def downgrade() -> None:
    op.drop_column("sale_returns", "credit_refund_amount")
