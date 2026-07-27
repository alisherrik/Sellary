"""add sale_payments so one sale can carry several tenders

Backfills every existing sale into the new table so the two representations
agree from the first moment. A credit sale that carried an initial payment
becomes two rows — the paid part and the remaining debt — because that is what
it always was; the information is only being relocated from
`customer_ledger_entries` to where the money readers will look for it.

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-07-27 14:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

PAYMENT_METHOD = postgresql.ENUM(
    "cash", "card", "mobile", "credit", name="paymentmethod", create_type=False
)
CARD_TYPE = postgresql.ENUM(
    "alif", "eskhata", "dc", name="cardtype", create_type=False
)

revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


NON_CANCELLED = ("completed", "partially_returned", "returned")


def upgrade() -> None:
    op.create_table(
        "sale_payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "sale_id",
            sa.Integer(),
            sa.ForeignKey("sales.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # Reuse the types `sales` already declares. `sa.Enum(create_type=False)`
        # is not honoured — it still emits CREATE TYPE and fails on the
        # duplicate — so the dialect type is used explicitly.
        sa.Column("method", PAYMENT_METHOD, nullable=False),
        sa.Column("card_type", CARD_TYPE, nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.CheckConstraint("amount > 0", name="ck_sale_payments_amount_positive"),
    )
    op.create_index(
        "ix_sale_payments_company_method", "sale_payments", ["company_id", "method"]
    )

    op.add_column(
        "sales",
        sa.Column(
            "is_split",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    _backfill()


def _backfill() -> None:
    bind = op.get_bind()

    # 1. The paid leg of every credit sale that took money up front. These are
    #    the `payment` ledger rows written by record_credit_sale, which are
    #    always negative amounts.
    bind.execute(
        sa.text(
            """
            INSERT INTO sale_payments
                (company_id, sale_id, method, card_type, amount, sort_order)
            SELECT s.company_id,
                   s.id,
                   CAST(l.payment_method AS paymentmethod),
                   NULL,
                   -SUM(l.amount),
                   0
            FROM sales s
            JOIN customer_ledger_entries l
              ON l.sale_id = s.id
             AND l.entry_type = 'payment'
             AND l.company_id = s.company_id
            WHERE s.payment_method = 'credit'
            GROUP BY s.company_id, s.id, l.payment_method
            HAVING -SUM(l.amount) > 0
            """
        )
    )

    # 2. The debt leg: whatever of a credit sale was not paid up front.
    bind.execute(
        sa.text(
            """
            INSERT INTO sale_payments
                (company_id, sale_id, method, card_type, amount, sort_order)
            SELECT s.company_id,
                   s.id,
                   'credit',
                   NULL,
                   s.total_amount - COALESCE(paid.total, 0),
                   1
            FROM sales s
            LEFT JOIN (
                SELECT sale_id, SUM(amount) AS total
                FROM sale_payments
                GROUP BY sale_id
            ) paid ON paid.sale_id = s.id
            WHERE s.payment_method = 'credit'
              AND s.total_amount - COALESCE(paid.total, 0) > 0
            """
        )
    )

    # 3. Every non-credit sale: one tender for the whole total.
    bind.execute(
        sa.text(
            """
            INSERT INTO sale_payments
                (company_id, sale_id, method, card_type, amount, sort_order)
            SELECT company_id, id, payment_method, card_type, total_amount, 0
            FROM sales
            WHERE payment_method <> 'credit'
              AND total_amount > 0
            """
        )
    )

    # 4. Mark the ones that ended up with more than a single tender.
    bind.execute(
        sa.text(
            """
            UPDATE sales SET is_split = true
            WHERE id IN (
                SELECT sale_id FROM sale_payments
                GROUP BY sale_id HAVING COUNT(*) > 1
            )
            """
        )
    )

    # 5. Reclassify the ledger rows that recorded an up-front payment on a
    #    credit sale. That money is now a tender in `sale_payments`, and every
    #    money report filters ledger rows on `entry_type = 'payment'` — leaving
    #    these as payments would count the same cash in the shift twice, once
    #    as a sale and once as a debt repayment. The amount is untouched, so
    #    customer balances do not move; only the label does, which is why the
    #    downgrade can put it back.
    bind.execute(
        sa.text(
            """
            UPDATE customer_ledger_entries
            SET entry_type = 'sale_tender'
            WHERE entry_type = 'payment'
              AND sale_id IS NOT NULL
              AND description = 'Первый платеж по продаже #' || sale_id
            """
        )
    )

    # 6. Refuse to finish if a cent went missing. A migration that quietly
    #    loses money is worse than one that stops and says so.
    #    Zero-total sales legitimately have no tenders and are excluded.
    mismatches = bind.execute(
        sa.text(
            """
            SELECT s.id, s.total_amount, COALESCE(p.total, 0) AS tendered
            FROM sales s
            LEFT JOIN (
                SELECT sale_id, SUM(amount) AS total
                FROM sale_payments GROUP BY sale_id
            ) p ON p.sale_id = s.id
            WHERE s.total_amount > 0
              AND s.total_amount <> COALESCE(p.total, 0)
            """
        )
    ).fetchall()

    if mismatches:
        sample = ", ".join(
            f"sale {row[0]}: total {row[1]} vs tendered {row[2]}"
            for row in mismatches[:10]
        )
        raise RuntimeError(
            f"sale_payments backfill does not balance for {len(mismatches)} "
            f"sale(s): {sample}"
        )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            UPDATE customer_ledger_entries
            SET entry_type = 'payment'
            WHERE entry_type = 'sale_tender'
              AND sale_id IS NOT NULL
              AND description = 'Первый платеж по продаже #' || sale_id
            """
        )
    )
    op.drop_column("sales", "is_split")
    op.drop_index("ix_sale_payments_company_method", "sale_payments")
    op.drop_table("sale_payments")
