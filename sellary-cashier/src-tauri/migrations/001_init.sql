CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    barcode TEXT,
    name TEXT NOT NULL,
    uom TEXT NOT NULL DEFAULT 'pcs',
    category_id INTEGER REFERENCES categories(id),
    sell_price REAL NOT NULL,
    tax_percent REAL NOT NULL DEFAULT 0,
    stock_quantity REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS outbox_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_sale_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','syncing','synced','failed')),
    request_json TEXT NOT NULL,
    response_json TEXT,
    last_error TEXT,
    created_at_client TEXT NOT NULL,
    synced_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
