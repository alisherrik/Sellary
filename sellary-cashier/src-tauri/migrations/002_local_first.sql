-- 002_local_first.sql — additive DDL only (CREATE TABLE IF NOT EXISTS / CREATE INDEX).
-- Never ALTER/DROP/RENAME; never touches products/categories/outbox_sales data.

CREATE TABLE IF NOT EXISTS sales (
    id                 INTEGER PRIMARY KEY,
    client_sale_id     TEXT NOT NULL UNIQUE,
    idempotency_key    TEXT NOT NULL,
    receipt_no         INTEGER NOT NULL,
    server_sale_id     INTEGER,
    subtotal           REAL NOT NULL DEFAULT 0,
    discount_amount    REAL NOT NULL DEFAULT 0,
    tax_amount         REAL NOT NULL DEFAULT 0,
    total_amount       REAL NOT NULL DEFAULT 0,
    paid_amount        REAL NOT NULL DEFAULT 0,
    change_amount      REAL NOT NULL DEFAULT 0,
    payment_method     TEXT NOT NULL,
    card_type          TEXT,
    notes              TEXT,
    cashier_user_id    INTEGER,
    cashier_username   TEXT,
    sync_status        TEXT NOT NULL DEFAULT 'pending'
                         CHECK (sync_status IN ('pending','syncing','synced','failed')),
    error_kind         TEXT,
    next_attempt_at    TEXT,
    first_failed_at    TEXT,
    last_error         TEXT,
    retry_count        INTEGER NOT NULL DEFAULT 0,
    stock_applied      INTEGER NOT NULL DEFAULT 0,
    acknowledged       INTEGER NOT NULL DEFAULT 0,
    created_at_client  TEXT NOT NULL,
    synced_at          TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX  IF NOT EXISTS idx_sales_sync_status  ON sales(sync_status);
CREATE INDEX  IF NOT EXISTS idx_sales_created_desc ON sales(created_at_client DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_receipt_no ON sales(receipt_no);

CREATE TABLE IF NOT EXISTS sale_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id         INTEGER NOT NULL,
    product_id      INTEGER NOT NULL,
    product_name    TEXT NOT NULL DEFAULT '',
    barcode         TEXT,
    uom             TEXT NOT NULL DEFAULT 'pcs',
    quantity        REAL NOT NULL,
    unit_price      REAL NOT NULL,
    tax_percent     REAL NOT NULL DEFAULT 0,
    line_subtotal   REAL NOT NULL DEFAULT 0,
    line_total      REAL NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    product_unit_id  INTEGER,
    sold_unit_label  TEXT,
    sold_unit_factor REAL,
    sold_quantity    REAL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS product_units (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    factor      REAL NOT NULL DEFAULT 1,
    sell_price  REAL,
    barcode     TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_name    ON products(name);

CREATE TABLE IF NOT EXISTS device_auth (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    device_id                TEXT NOT NULL,
    device_token_expires_at  TEXT,
    pin_hash                 TEXT,
    pin_set_at               TEXT,
    failed_pin_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until             TEXT,
    user_id                  INTEGER,
    username                 TEXT,
    company_id               INTEGER,
    company_name             TEXT,
    user_role                TEXT,
    last_online_auth_at      TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
