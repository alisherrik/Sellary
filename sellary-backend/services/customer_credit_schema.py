from sqlalchemy import text

from core.database import engine


def ensure_customer_credit_schema() -> None:
    """Create the small credit-ledger schema delta when Alembic is pinned.

    The project currently deploys with Railway's preDeployCommand pinned to an
    existing migration revision. These idempotent DDL statements keep the new
    credit feature deployable without relying on generated migration files.
    """
    if engine.dialect.name != "postgresql":
        return

    statements = [
        "ALTER TYPE paymentmethod ADD VALUE IF NOT EXISTS 'credit'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS description VARCHAR(500)",
        "ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'paid'",
        """
        CREATE TABLE IF NOT EXISTS customer_ledger_entries (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id),
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            sale_id INTEGER NULL REFERENCES sales(id),
            entry_type VARCHAR(32) NOT NULL,
            amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(20) NULL,
            description VARCHAR(500) NULL,
            created_by_user_id INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_customer_ledger_company_customer_created
        ON customer_ledger_entries(company_id, customer_id, created_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_customer_ledger_company_sale
        ON customer_ledger_entries(company_id, sale_id)
        """,
        "UPDATE sales SET payment_status = 'paid' WHERE payment_status IS NULL",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
