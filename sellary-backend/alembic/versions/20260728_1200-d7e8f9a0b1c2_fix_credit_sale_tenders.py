"""Rebuild the tenders of credit sales that were backfilled from debt repayments

`f3a4b5c6d7e8` created `sale_payments` from the ledger. Its first step took the
paid leg of a credit sale from every `customer_ledger_entries` row with
`entry_type = 'payment'`, on the stated assumption that those rows are written
by `record_credit_sale` — the money handed over at the counter. They are not
only that: a customer who comes back three days later and settles the debt is
recorded the same way, and the two are indistinguishable by type alone.

So a sale sold в долг for 304.00 with 100.00 paid at the till and 204.00
brought back three days later was given a single cash tender of 304.00, dated
at the sale. The 204.00 then counted twice in the drawer — once as a cash sale
on the day of the sale, once as the debt repayment it actually was. Step 5 of
that migration retyped only the rows whose description is
`Первый платеж по продаже #<id>`, so the later repayment survived as a
`payment` and the double count with it. Step 6's balance check could not see
it: the tenders do sum to the sale total, they are simply the wrong tenders.

In the shop that found this, 46 sales were affected and 1066.64 was counted
twice, 396.49 of it inside the till account's window. The drawer read 14203.36
when it held 13806.87.

The fix rebuilds those sales' tenders from what the ledger says actually
crossed the counter — the `sale_tender` rows, which is the type the live code
writes and which `f3a4b5c6d7e8` step 5 already applied to the genuine up-front
payments. Everything else becomes the debt leg. Customer balances do not move:
this touches `sale_payments` only, and the ledger is left exactly as it is.

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-07-28 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "c6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A credit sale is wrong when the money its tenders claim reached the till is
# not the money the ledger says reached the till.
AFFECTED = """
    SELECT s.id, s.company_id, s.total_amount, s.card_type
    FROM sales s
    WHERE s.payment_method = 'credit'
      AND COALESCE((SELECT SUM(p.amount) FROM sale_payments p
                    WHERE p.sale_id = s.id AND p.method <> 'credit'), 0)
       <> COALESCE((SELECT -SUM(l.amount) FROM customer_ledger_entries l
                    WHERE l.sale_id = s.id AND l.entry_type = 'sale_tender'), 0)
"""


def upgrade() -> None:
    bind = op.get_bind()

    # Held in a temp table because the rebuild deletes the very rows the
    # predicate reads: computed after the delete it would match everything.
    bind.execute(sa.text(f"CREATE TEMP TABLE _wrong_tenders AS {AFFECTED}"))

    bind.execute(
        sa.text(
            "DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM _wrong_tenders)"
        )
    )

    # 1. What actually crossed the counter, by method. `card_type` comes from the
    #    sale: the ledger does not carry it, and the sale's own column is what
    #    the old code wrote when a card was used.
    bind.execute(
        sa.text(
            """
            INSERT INTO sale_payments
                (company_id, sale_id, method, card_type, amount, sort_order)
            SELECT w.company_id,
                   w.id,
                   CAST(COALESCE(l.payment_method, 'cash') AS paymentmethod),
                   CASE WHEN COALESCE(l.payment_method, 'cash') = 'card'
                        THEN w.card_type END,
                   -SUM(l.amount),
                   0
            FROM _wrong_tenders w
            JOIN customer_ledger_entries l
              ON l.sale_id = w.id
             AND l.company_id = w.company_id
             AND l.entry_type = 'sale_tender'
            GROUP BY w.company_id, w.id, w.card_type, l.payment_method
            HAVING -SUM(l.amount) > 0
            """
        )
    )

    # 2. The rest of the sale is the debt, which is what в долг means.
    bind.execute(
        sa.text(
            """
            INSERT INTO sale_payments
                (company_id, sale_id, method, card_type, amount, sort_order)
            SELECT w.company_id,
                   w.id,
                   'credit',
                   NULL,
                   w.total_amount - COALESCE(paid.total, 0),
                   1
            FROM _wrong_tenders w
            LEFT JOIN (
                SELECT sale_id, SUM(amount) AS total
                FROM sale_payments
                GROUP BY sale_id
            ) paid ON paid.sale_id = w.id
            WHERE w.total_amount - COALESCE(paid.total, 0) > 0
            """
        )
    )

    # 3. `is_split` follows the tenders it describes. A sale that had one wrong
    #    cash tender and now has a till leg and a debt leg becomes split; one
    #    that turns out to have been wholly on the tab stops being split.
    bind.execute(
        sa.text(
            """
            UPDATE sales SET is_split = (
                SELECT COUNT(*) FROM sale_payments p WHERE p.sale_id = sales.id
            ) > 1
            WHERE id IN (SELECT id FROM _wrong_tenders)
            """
        )
    )

    # 4. Refuse to finish if a cent went missing, the same guard the original
    #    backfill ends with. Zero-total sales legitimately have no tenders.
    mismatches = bind.execute(
        sa.text(
            """
            SELECT w.id, w.total_amount, COALESCE(p.total, 0) AS tendered
            FROM _wrong_tenders w
            LEFT JOIN (
                SELECT sale_id, SUM(amount) AS total
                FROM sale_payments GROUP BY sale_id
            ) p ON p.sale_id = w.id
            WHERE w.total_amount > 0
              AND w.total_amount <> COALESCE(p.total, 0)
            """
        )
    ).fetchall()
    if mismatches:
        sample = ", ".join(
            f"sale {row[0]}: total {row[1]} vs tendered {row[2]}" for row in mismatches[:10]
        )
        raise RuntimeError(
            f"credit tender rebuild does not balance for {len(mismatches)} "
            f"sale(s): {sample}"
        )

    bind.execute(sa.text("DROP TABLE _wrong_tenders"))


def downgrade() -> None:
    """Deliberately empty.

    The rows this replaced said cash reached the drawer on a day it did not.
    Putting them back would restore a double count, and nothing depends on
    their shape — `sale_payments` is derived from the ledger, which was never
    touched. Downgrading `f3a4b5c6d7e8` drops the table outright anyway.
    """
