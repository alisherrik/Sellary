-- 003_offline_credit.sql — additive DDL only (CREATE TABLE IF NOT EXISTS / ALTER ADD COLUMN).
-- Offline credit (В долг) + offline customers + offline debt payments. Never ALTER/DROP/RENAME
-- existing columns; never touches products/categories/sales data. Forward-only alongside 001/002.

CREATE TABLE IF NOT EXISTS customers (
    client_customer_id  TEXT PRIMARY KEY,            -- always present (uuid or srv:<id>); local identity
    server_id           INTEGER,                     -- backend customers.id, filled after sync (NULL until)
    name                TEXT NOT NULL,
    phone               TEXT,                         -- dedup key on server (company_id, phone)
    email               TEXT,
    address             TEXT,
    description         TEXT,
    balance             REAL NOT NULL DEFAULT 0,      -- server-derived debt at last pull (NOT incl. local unsynced)
    is_active           INTEGER NOT NULL DEFAULT 1,
    sync_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (sync_status IN ('pending','syncing','synced','failed')),
    error_kind          TEXT,
    next_attempt_at     TEXT,
    first_failed_at     TEXT,
    last_error          TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    created_at_client   TEXT NOT NULL,
    synced_at           TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_server_id ON customers(server_id) WHERE server_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sync ON customers(sync_status);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS customer_payments (
    client_payment_id   TEXT PRIMARY KEY,
    idempotency_key     TEXT NOT NULL,
    customer_client_id  TEXT NOT NULL,                -- references customers.client_customer_id
    amount              REAL NOT NULL,
    payment_method      TEXT NOT NULL,                -- 'cash'|'card'|'mobile'
    description         TEXT,
    applied_amount      REAL,                          -- filled from server result (may be < amount if capped)
    server_customer_id  INTEGER,
    sync_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (sync_status IN ('pending','syncing','synced','failed')),
    error_kind          TEXT,
    next_attempt_at     TEXT,
    first_failed_at     TEXT,
    last_error          TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    created_at_client   TEXT NOT NULL,
    synced_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_payments_sync ON customer_payments(sync_status);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_client_id);

ALTER TABLE sales ADD COLUMN customer_client_id     TEXT;   -- set for credit sales
ALTER TABLE sales ADD COLUMN initial_payment_method TEXT;   -- 'cash'|'card'|'mobile' when initial payment > 0
