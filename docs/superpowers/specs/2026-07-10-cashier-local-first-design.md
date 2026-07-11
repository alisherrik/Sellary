# Sellary Cashier — Local-First Offline POS: Reconciled Design Spec

## 1. Overview

This spec turns the **Tauri cashier** (`sellary-cashier`) into a Loyverse-style, local-first, offline-first native POS. It is the single reconciled design that supersedes the seven per-subsystem drafts, collapsing every cross-subsystem contradiction into ONE consistent model — most importantly, **one agreed way sales are stored locally and read by both the sync worker and the Sales-History screen**.

The web frontend (`sellary-frontend`) and the FastAPI backend (`sellary-backend`) stay **online** and MUST keep working unchanged. Every backend change here is **additive and backward-compatible** — new endpoints, new nullable columns, new tables, new optional/defaulted fields only. Nothing existing is renamed, removed, or given new semantics that the web depends on.

### Fixed architecture decision (design WITHIN this — not relitigated)
- The cashier UI **always reads/writes local SQLite only**. Internet is only a background state.
- **Outbox + background sync worker.** Triggers: timer + reconnect + app-focus + post-sale; single-flight with coalescing; retry with backoff; crash recovery.
- **Push sales, pull catalog.** Full catalog refresh is fine for < 1000 products.
- The **server accepts offline sales as historical facts** (oversell tolerated on the sync path).
- **Local stock decrements immediately on sale**, not on sync success.
- **Offline auth = device-token + local PIN.**
- **Transparency:** an "Не отправлено N / Unsynced N" badge; **block logout while unsynced sales exist**.

### Single-device / offline-week constraints
- **1 cashier device per shop.** This makes single-row auth, `MAX(id)+1` id assignment, and per-device receipt numbering correct.
- **< 1000 products.** Full-refresh pulls are cheap; no delta sync needed.
- **The device may be OFFLINE for a week or more.** The app must open, sell, and record history the entire time with no server round-trip. This guarantee holds **only after a one-time successful online provisioning** (login → device register → PIN set → first catalog bootstrap).
- The UI must **match or exceed** the existing web POS and Sales-History screens and feel beautiful and rock-stable.

### The two release-blocking contradictions this spec resolves
1. **Local sale storage.** The drafts disagreed: one deleted `outbox_sales`/`request_json` and replaced it with structured `sales`/`sale_items`; four others still read `outbox_sales.request_json`. **Resolution: adopt ONE unified structured `sales` + `sale_items` model** that also carries the sync-engine's `error_kind`/`next_attempt_at`/`first_failed_at` columns and the history screen's snapshot columns. `outbox_sales` becomes a legacy, backfilled-and-kept table; the "outbox" is a `sync_status` filter, not a table.
2. **Device auth + migrations.** The drafts specified two token models (opaque vs JWT), three PIN KDFs, and four colliding `version:2` local migrations plus two backend migrations off the same head. **Resolution: one opaque revocable device token, one PIN KDF (argon2id in Rust), one local `version:2` migration, and one backend Alembic migration off the pinned head** (railway pin bumped in the same PR).

---

## 2. Local SQLite schema & migration `[local-db]`

### 2.1 Decision: ONE unified local `sales` + `sale_items` model
`outbox_sales` is **not** extended and is **not** the read model. A real local `sales`/`sale_items` schema is the single source of truth for BOTH the sync worker and the Sales-History screen:

- **Sync worker** reads `WHERE sync_status IN ('pending','failed')` and rebuilds the `SyncSaleCreate` payload deterministically from the structured columns (no `request_json` snapshot to drift).
- **History screen** reads the same rows ordered by `created_at_client DESC`, joining `sale_items`.
- One row per sale, one write path, one source of truth. Sales are immutable after creation, so a payload rebuild is always faithful. `client_sale_id`/`idempotency_key` stay as persisted columns so idempotent replay is unaffected.

`request_json` is intentionally dropped. A separate `receipt_json` snapshot column is **not** added — the structured `sale_items` snapshot columns (`product_name`, `barcode`, `uom`, `tax_percent`, `line_subtotal`, `line_total`) fully harden the receipt against later product rename/delete/retax, so a JSON blob would be redundant.

### 2.2 The ONE `version:2` local migration
There is exactly one new local migration, `002_local_first.sql`, registered as `Migration { version: 2, ... }` in `src-tauri/src/lib.rs`. It merges all four conflicting draft `002`s into a single **additive DDL** script (only `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX`; it never `ALTER`/`DROP`/`RENAME`s existing tables and never touches `products`/`categories`/`outbox_sales` data). This keeps the Rust migration trivially safe and avoids relying on SQLite JSON1 inside a Rust migration.

```rust
.add_migrations(
    "sqlite:sellary_cashier.db",
    vec![
        Migration { version: 1, description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "local-first sales, history, device auth",
            sql: include_str!("../migrations/002_local_first.sql"), kind: MigrationKind::Up },
    ],
)
```

### 2.3 DDL — `sales`
Carries money/payment columns (history), a per-device `receipt_no`, sync-queue fields, **and the sync-engine state fields** (`error_kind`, `next_attempt_at`, `first_failed_at`) so the backoff/needs-attention engine and this schema are compatible.

```sql
CREATE TABLE IF NOT EXISTS sales (
    id                 INTEGER PRIMARY KEY,          -- assigned = MAX(id)+1 (single device)
    client_sale_id     TEXT NOT NULL UNIQUE,
    idempotency_key    TEXT NOT NULL,
    receipt_no         INTEGER NOT NULL,             -- per-device human receipt number (MAX+1)
    server_sale_id     INTEGER,                      -- backend sale id, filled after sync
    -- money (base UZS)
    subtotal           REAL NOT NULL DEFAULT 0,
    discount_amount    REAL NOT NULL DEFAULT 0,
    tax_amount         REAL NOT NULL DEFAULT 0,
    total_amount       REAL NOT NULL DEFAULT 0,
    paid_amount        REAL NOT NULL DEFAULT 0,
    change_amount      REAL NOT NULL DEFAULT 0,
    -- payment (CANONICAL lowercase)
    payment_method     TEXT NOT NULL,                -- 'cash'|'card'|'mobile'
    card_type          TEXT,                         -- 'alif'|'eskhata'|'dc' | NULL
    notes              TEXT,
    cashier_user_id    INTEGER,                      -- from device_auth bound identity
    cashier_username   TEXT,
    -- sync queue + state machine (the former outbox)
    sync_status        TEXT NOT NULL DEFAULT 'pending'
                         CHECK (sync_status IN ('pending','syncing','synced','failed')),
    error_kind         TEXT,                         -- NULL | 'transient' | 'permanent'
    next_attempt_at    TEXT,                         -- ISO; backoff schedule for transient
    first_failed_at    TEXT,                         -- ISO; first failure of a run
    last_error         TEXT,
    retry_count        INTEGER NOT NULL DEFAULT 0,
    -- stock idempotency (crash-safe, exactly-once decrement)
    stock_applied      INTEGER NOT NULL DEFAULT 0,   -- 0=not yet decremented, 1=done
    created_at_client  TEXT NOT NULL,                -- ISO, device clock
    synced_at          TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX  IF NOT EXISTS idx_sales_sync_status  ON sales(sync_status);
CREATE INDEX  IF NOT EXISTS idx_sales_created_desc ON sales(created_at_client DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_receipt_no ON sales(receipt_no);
```

Notes: the backend maps `status=duplicate → synced`, so the CHECK set omits `duplicate`. `syncing` is a transient in-flight marker recovered to `failed`/`transient` on restart. `error_kind` subdivides `failed` without rebuilding the CHECK constraint.

### 2.4 DDL — `sale_items`
```sql
CREATE TABLE IF NOT EXISTS sale_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id         INTEGER NOT NULL,            -- references sales(id); no FK (see atomicity)
    product_id      INTEGER NOT NULL,
    product_name    TEXT NOT NULL DEFAULT '',    -- SNAPSHOT (hardens receipt vs later rename/delete)
    barcode         TEXT,                        -- snapshot
    uom             TEXT NOT NULL DEFAULT 'pcs', -- base uom snapshot
    quantity        REAL NOT NULL,               -- BASE units (matches backend sale_items.quantity)
    unit_price      REAL NOT NULL,               -- sell_price per base unit
    tax_percent     REAL NOT NULL DEFAULT 0,     -- snapshot
    line_subtotal   REAL NOT NULL DEFAULT 0,
    line_total      REAL NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    -- === RESERVED (multi-UOM, Phase 2) — nullable, unused in Phase 1 ===
    product_unit_id  INTEGER,                    -- NULL = base unit
    sold_unit_label  TEXT,
    sold_unit_factor REAL,
    sold_quantity    REAL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
```

The reserved multi-UOM columns are added now (so the schema lands once) but stay NULL in Phase 1. Phase-1 sync sends only `{product_id, quantity(base), sell_price}`. `quantity` is always **base** units.

### 2.5 DDL — catalog + reserved `product_units` (empty in Phase 1) + hot-path indexes
`products` and `categories` are unchanged. `product_units` is created but stays empty until the additive backend bootstrap sends units (Phase 2). Add the POS hot-path indexes that are missing today.

```sql
CREATE TABLE IF NOT EXISTS product_units (
    id          INTEGER PRIMARY KEY,             -- server id
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
```

### 2.6 DDL — `device_auth` (single row)
Single-device ⇒ exactly one row (`CHECK id=1`). Bearer secrets (`access_token`, `device_token`) live in **Stronghold**, not here. This table holds only the **argon2id PIN hash** (not a bearer secret), lockout counters, token expiry mirror, and bound identity.

```sql
CREATE TABLE IF NOT EXISTS device_auth (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    device_id                TEXT NOT NULL,              -- stable UUID per install
    device_token_expires_at  TEXT,                       -- ISO mirror; token itself in Stronghold
    -- offline PIN unlock (argon2id, hash only)
    pin_hash                 TEXT,                        -- argon2id PHC string (salt embedded)
    pin_set_at               TEXT,
    failed_pin_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until             TEXT,                        -- ISO lockout after N failures
    -- bound identity (from last online login + select-company)
    user_id                  INTEGER,
    username                 TEXT,
    company_id               INTEGER,
    company_name             TEXT,
    user_role                TEXT,
    last_online_auth_at      TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.7 New `meta` keys
| key | meaning |
|---|---|
| `last_sync_at` | ISO of last successful push cycle |
| `last_catalog_pull_at` | ISO of last `sync/bootstrap` |
| `server_time_offset_ms` | `serverTime − deviceTime` in ms, from bootstrap `server_time` (see §7 C0), to correct week-long clock skew |
| `outbox_migrated_v2` | `'1'` once the TS backfill of `outbox_sales → sales` has run |

`receipt_no` uses `MAX(receipt_no)+1` (single device, sales never deleted) — no counter key.

### 2.8 Backfill `outbox_sales → sales` (idempotent TS, corrected stock flag)
Migration `002` is DDL-only. The data copy runs once at startup in idempotent TypeScript, guarded by `meta.outbox_migrated_v2`, leaving `outbox_sales` **fully intact** (zero data-loss, rollback-safe). Reusing `insertSaleRaw` guarantees backfilled rows are byte-identical to fresh ones.

**Corrected `stock_applied` premise (critique must-fix).** The *current* code only decrements stock on sync **success** (`POSPage` lines ~170-177). Therefore legacy `pending`/`failed`/`syncing` rows were **never** decremented; only legacy `synced` rows were. The backfill sets:

- legacy `synced` → `stock_applied = 1` (already applied historically),
- legacy `pending`/`syncing`/`failed` → `stock_applied = 0` (never applied),

then `reconcileLocalState()` runs immediately after the backfill and decrements every `stock_applied = 0` row exactly once. This recovers the offline decrements the old code lost. Each row is wrapped in try/catch and logs a `sync_event` on malformed `request_json` rather than aborting the whole migration.

Migrated statuses: `syncing → failed` + `error_kind='transient'`; payment method/card type lowercased. `outbox_sales` is preserved as a harmless unread legacy table; dropping it is deferred to a future `003`.

### 2.9 Atomicity pattern (pool-safe, no cross-connection transaction)
`@tauri-apps/plugin-sql` runs each `execute` on a pooled connection, so `BEGIN`/`COMMIT` across separate calls is unreliable. `insertSale` therefore:
1. computes `nextId = MAX(id)+1`, `nextReceipt = MAX(receipt_no)+1`;
2. inserts `sale_items` with `sale_id = nextId` **first** (orphan-safe — swept by `reconcileLocalState`);
3. inserts the `sales` row **last with `stock_applied=0`** — this single-statement insert is the atomic commit point;
4. decrements product stock (base units), then sets `stock_applied=1`.

A crash between (3) and (4) is healed idempotently by `reconcileLocalState()` on next launch. This gives effective exactly-once stock decrement without a DB transaction.

`reconcileLocalState()` (called once at startup after migration + backfill): (a) `DELETE` orphan `sale_items` whose `sale_id` has no `sales` row; (b) for `sales WHERE stock_applied=0`: decrement stock, set `stock_applied=1`.

### 2.10 `db.ts` data-access surface
Remove the outbox-only API (`addToOutbox`, `getPendingSales`, `getOutboxSaleById`, `updateOutboxStatus`, `markOutboxSalesFailed`, `OutboxSale`). Add:

```ts
// write
insertSale(input: NewSaleInput): Promise<{ saleId:number; receiptNo:number }>;   // crash-safe, decrements stock
// sync worker
getSendableSales(nowIso: string): Promise<SaleWithItems[]>;   // pending OR (failed & transient & next_attempt_at<=now), oldest first
markSaleSyncing(saleId:number): Promise<void>;
markSaleSynced(saleId:number, serverSaleId:number|null): Promise<void>;
markTransientFailure(saleIds:number[], nextAttemptAt:string, error:string): Promise<void>;
markPermanentFailure(saleId:number, error:string): Promise<void>;
recoverSyncingSales(nowIso:string): Promise<number>;          // syncing → failed/transient with backoff
getUnsyncedCount(): Promise<number>;                          // sync_status != 'synced' (badge + logout gate)
getNeedsAttentionCount(): Promise<number>;                    // failed & permanent
getUnsyncedBaseQtyByProduct(): Promise<Map<number,number>>;   // Σ base qty of sales sync_status != 'synced' (stock reconcile)
// history
getSalesHistory(opts): Promise<LocalSale[]>;                  // filters + LIMIT/OFFSET, created_at_client DESC
getHistoryAggregates(opts): Promise<{ turnover:number; count:number; unsynced:number; hourly:number[] }>;
getSaleWithItems(saleId:number): Promise<SaleWithItems|null>;
// startup
reconcileLocalState(): Promise<void>;
migrateOutboxToSalesOnce(): Promise<void>;
// device auth DAO (single row id=1)
getDeviceAuth(): Promise<DeviceAuth|null>;
ensureDeviceAuth(deviceId:string): Promise<DeviceAuth>;
setPinHash(hash:string): Promise<void>;
bindDeviceIdentity(i): Promise<void>;
recordPinFailure(lockUntil?:string|null): Promise<void>;
resetPinFailures(): Promise<void>;
```

Keep `getProducts / getProductByBarcode / getProductById / getCategories / upsertCategories / getMeta / setMeta / addSyncEvent`. Replace the blind `upsertProducts` overwrite with the reconciling upsert in §5. `decrementLocalStock` becomes internal to `insertSale`/`reconcileLocalState`.

---

## 3. Offline auth: device token + local PIN `[offline-auth]`

### 3.1 Reconciled decision (resolves the two-designs / three-KDFs conflict)
- **Device credential = one opaque random token** (`secrets.token_urlsafe(48)`), stored **hashed** server-side in a new `cashier_devices` table, revocable, membership-re-checked on every use. Not a JWT (a 180-day bearer must be revocable and re-checkable).
- **The `access_token` minted by refresh is byte-compatible** with the one `select-company` issues (`token_type="access"`, 24h, same claims) plus an optional additive `device_id` claim that existing decoders ignore. Every protected/sync endpoint accepts it unchanged.
- **One PIN KDF: argon2id via a Rust command.** The PIN hash lives **locally** in `device_auth.pin_hash` (a hash is safe in the plaintext SQLite file). The **server does not store the PIN.** Secrets (`access_token`, `device_token`) live in **Stronghold**.
- **One revocation field:** `cashier_devices.is_active` (drop `token_version` and `revoked_at` duplication).

### 3.2 Backend `cashier_devices` (Postgres, one Alembic migration — see §7)
```
id                 INTEGER PK
company_id         INTEGER FK companies.id NOT NULL
user_id            INTEGER FK users.id NOT NULL        -- the cashier this device acts as
device_id          TEXT UNIQUE NOT NULL                -- public opaque UUID
name               TEXT                                -- label e.g. "Kassa 1"
token_hash         TEXT NOT NULL                       -- sha256 of the secret device_token
is_active          BOOLEAN NOT NULL DEFAULT TRUE        -- single kill-switch
expires_at         TIMESTAMPTZ                          -- now + DEVICE_TOKEN_EXPIRE_DAYS; sliding-renewed
last_seen_at       TIMESTAMPTZ
created_at         TIMESTAMPTZ DEFAULT now()
created_by_user_id INTEGER FK users.id
```
Index `(company_id, is_active)`, unique `device_id`.

### 3.3 Endpoints — router `api/device_auth.py`, prefix `/api/auth/devices`
1. **`POST /api/auth/devices/register`** — auth: existing company-scoped `access_token` (`Depends get_auth_context`); **any authenticated company member may self-register on first run** (resolves the provisioning-owner gap; a cashier-role token can register). Binds a row to `auth.user.id` + `auth.company_id`. **Enforces 1-device/shop by deactivating (`is_active=false`) any prior active device for that company** (self-healing re-registration), then inserts. Returns the plaintext `device_token` **once** + `expires_at`. Light rate-limit.
2. **`POST /api/auth/devices/refresh`** — **NO bearer** (this is the offline-return call). Body `{device_id, device_token}`.
   - Lookup by `device_id`; **constant-time compare** `token_hash`; reject if `is_active=false` or `expires_at` past → 401. **(Hard requirement, not a note.)**
   - **Re-check membership** (same logic as `get_auth_context`): pinned `user_id`+`company_id` must still have an active `CompanyMembership` and active company/user → else 403. Preserves the "membership re-checked every request" invariant.
   - Mint a fresh 24h `access_token` via existing `create_access_token(...)` with the same claim set + optional `device_id`.
   - Update `last_seen_at=now`, sliding-renew `expires_at = now + DEVICE_TOKEN_EXPIRE_DAYS`.
   - **Rate-limited by `device_id`/IP** (reuse `login_rate_limiter`). **(Hard requirement.)**
3. **`DELETE /api/auth/devices/{device_id}`** — `Depends require_manager_or_admin` → `is_active=false` (owner/admin kill switch).
4. **`GET /api/auth/devices`** — admin list for the panel.

Config: `DEVICE_TOKEN_EXPIRE_DAYS: int = 180` (additive default in `core/config.py`), sliding renewal on every refresh so a device that syncs at least once / 180 days never expires. `access_token` unchanged 24h.

### 3.4 Cashier side
- **Rust argon2id commands** (`pin_hash(pin)->phc`, `pin_verify(pin, phc)->bool`) with constant-time verify. `argon2` crate is already transitively present via stronghold; confirm it builds on `windows-latest` CI.
- **`session.ts`**: new Stronghold key `device_token`; helpers `saveDeviceCredential/loadDeviceCredential/clearDeviceCredential`, `savePin/verifyPin/clearPin`. Keep `access_token` persistence but treat it as an **optional cache** — never log out purely because it expired.
- **`api.ts`**: `registerDevice(name, deviceId?)`, `refreshDevice(deviceId, deviceToken)` (no bearer) + response types, reusing `apiFetch`/`ApiError`.
- **`auth-store.ts`** state: `hasDevice`, `hasPin`, `isLocked`, `needsReauth`.
  - `restoreSession()` reworked: **app-open depends on `hasDevice && hasPin`** → show PIN unlock; it **MUST NOT** fail on an expired `access_token`.
  - `unlockWithPin(pin)`: local argon2id verify, throttled (lockout below). On success `isAuthenticated=true`, open POS; if online and token missing/near-expiry, kick `ensureFreshAccessToken()` in the background (non-blocking).
  - `ensureFreshAccessToken()`: single-flight; if online and (no token OR exp within ~12h) and device_token present → `refresh`; on 401/403 set `needsReauth=true` (banner) but keep the app fully usable offline.
  - `logout()` stays blocked while unsynced sales exist; on logout clear device + PIN + session.
- **Lockout policy:** 5 failed PIN attempts → exponential backoff; store `failed_pin_attempts` + `locked_until` in `device_auth`. Exceeding lockout requires waiting out `locked_until`; **the only PIN recovery is an online login → select-company → re-register → re-set PIN** (accepted single-device tradeoff).

### 3.5 First-run / provisioning order (resolves the unowned-ordering gap)
Owned end-to-end by `auth-store.selectAndBootstrap()`:
```
online login  →  select-company  →  registerDevice()  →  PinSetupPage (set PIN once)  →  sync/bootstrap (first catalog)
```
- **Offline first-run is impossible and is explicitly handled:** if the very first launch has no `device_auth` row and no network, show a blocking **"Для первой настройки нужен интернет"** screen (see §9). The week-offline guarantee only begins after one successful online provisioning; document this in the installer/runbook.

---

## 4. Background sync engine `[sync-engine]`

A singleton `sync-engine.ts` owns all triggers, one global single-flight lock with coalescing, the per-sale state machine, error classification, backoff, and crash recovery. `sync-service.ts` is reduced to two **pure, mutex-free** helpers. A new `sync-store.ts` (Zustand) surfaces state to the UI.

### 4.1 Per-sale outbox state machine
Statuses stay in the CHECK set `pending|syncing|synced|failed`; `error_kind` subdivides `failed`.
```
 insertSale → pending ──engine picks up──▶ syncing ──┬─ synced/duplicate ─▶ ● synced (terminal)
                    ▲                                 │
                    │                                 ├─ per-sale server error(text) ─▶ failed + error_kind='permanent'
     backoff timer  │                                 │                                   (needs_attention; NO auto-retry)
     (next_attempt) │                                 └─ network/5xx/timeout ─▶ failed + error_kind='transient'
                    │                                                              (bump retry, set next_attempt_at)
                    └──────────── crash: syncing ─▶ failed+transient (recoverSyncingSales) ◀────────────
```
- **sendable** = `pending` OR (`failed` AND `error_kind='transient'` AND `next_attempt_at <= now`).
- **needs_attention** = `failed` AND `error_kind='permanent'` (only the operator can act).
- **unsynced** (badge + logout gate) = `pending` + `syncing` + transient-`failed`. `needs_attention` is counted **separately**.

Classification on reconcile: result `synced`/`duplicate` → synced; result `failed` with a non-empty `error` → **permanent**; whole-request failure (fetch throw / non-2xx / timeout / health offline) → **transient** for every row in the batch.

### 4.2 Engine state machine (process-level)
`idle | syncing | backing_off | offline`. Only `syncing` holds the single-flight lock.

### 4.3 Triggers → all funnel into `requestSync(reason)`
| Trigger | Mechanism | Cadence |
|---|---|---|
| Periodic | `setInterval` | 30 000 ms while authenticated; fires only if `unsyncedCount>0` |
| Health poll | `setInterval` | 10 000 ms; `GET /health` with 4 s AbortController; updates `online`; on false→true fires `requestSync('reconnect')` + `maybeRefreshCatalog()` |
| Reconnect (OS hint) | `online`/`offline` events + `navigator.onLine` | `online` → immediate health ping (hint only; health ping authoritative) |
| App focus/resume | Tauri `onFocusChanged` + `visibilitychange` | one health ping + `requestSync('focus')` |
| Post-sale | `POSPage.handleCompleteSale` | after `insertSale`, fire-and-forget `requestSync('post-sale')` |
| Manual | header / Settings | `syncNow()` = `requestSync('manual',{force:true})` |

`requestSync` is debounced/coalesced (≤250 ms).

### 4.4 Single-flight + coalescing
```ts
let inFlight: Promise<SyncPassResult> | null = null;
let rerunRequested = false;
export function requestSync(reason, opts) {
  if (inFlight) { rerunRequested = true; return inFlight; }
  inFlight = runPass(reason).finally(() => {
    inFlight = null;
    if (rerunRequested) { rerunRequested = false; requestSync('coalesced'); }
  });
  return inFlight;
}
```
The old module-level `isSyncing` in `sync-service.ts` is **deleted**; the engine is the sole mutex owner.

### 4.5 `runPass` sequence (push then pull, inside the lock)
1. `setEngineState('syncing')`.
2. Health ping. Offline → `setEngineState('offline')`, log `sync_event`, return.
3. `recoverSyncingSales(now)` — crash recovery; recovered rows get `error_kind='transient'` + `next_attempt_at = now + backoff(retry_count)`.
4. **Push:** `getSendableSales(now)`; mark them `syncing`; build `SyncSale[]` from structured columns; `pushOnce(batch)`.
   - success → reconcile each result by `client_sale_id` (§4.6);
   - throw/non-2xx → `markTransientFailure(all, next_attempt_at)`.
5. **Pull (optional):** `maybeRefreshCatalog()` only if due (§5) and the push did not just raise a transport error. Sequenced **after** push so server stock already reflects just-synced sales.
6. Update `sync-store` (counts, `lastSyncedAt`, `lastError`, `nextRetryAt`, `catalogRefreshedAt`); set engine `idle` (or `backing_off` if transient rows remain); log `sync_event`.

### 4.6 Reconciliation
- `synced`/`duplicate` → `markSaleSynced(id, result.sale_id)`, store `server_sale_id`, `synced_at`. (Idempotency: a resend of a pre-crash-accepted sale returns `duplicate` → synced; no double-sale.)
- `failed` (business error) → `markPermanentFailure(id, result.error)` → needs_attention list, not the retry queue.
- Missing result for a requested `client_sale_id` → left `syncing`, cleaned next pass.

### 4.7 Backoff (transient only)
`delay = min(cap, base·2^retry_count)·(1 ± jitter)`, `base=5 s`, `cap=5 min`, `jitter=±20%`. **Never hard-drop a sale.** After `retry_count ≥ 8` the interval pins at 5 min and the UI marks the row "needs attention (repeated failures)" while auto-retry continues. The engine schedules a single `setTimeout` to the earliest `next_attempt_at`.

### 4.8 `sync-store.ts` (Zustand)
State: `online`, `engineState`, `unsyncedCount`, `needsAttentionCount`, `lastSyncedAt`, `lastError`, `nextRetryAt`, `catalogRefreshedAt`, `isSyncing`. Actions: `syncNow()`, `refreshCatalog()`, internal setters. The store is the single source of truth; `POSPage` subscribes instead of running its own health interval.

### 4.9 `sync-service.ts` reduced to pure helpers
```ts
pushOnce(sendable: SaleWithItems[]): Promise<SyncSaleResult[]>   // build payload, pushSales, return raw results
pullCatalog(): Promise<{products:number; categories:number}>    // fetchBootstrap + reconcile (§5)
```

---

## 5. Local stock decrement + oversell-tolerant sync `[stock]`

**These changes ship as ONE atomic release** (immediate decrement + catalog reconcile). Shipping decrement without reconcile, or vice-versa, lets a single reconnect wipe a week of offline decrements.

### 5.1 Immediate, atomic local decrement
Every checkout decrements local stock in **base units** as part of `insertSale` (§2.9): stock decrements at insert time, flagged by `stock_applied`, **not** on sync success. `POSPage.handleCompleteSale` no longer decrements post-sync (that block — reading the already-cleared cart — is deleted). Base-unit rule: `base_quantity = unit_quantity × factor` (factor 1 today); the same `base_quantity` feeds both the outbox item and the local decrement, so they can never disagree.

### 5.2 Catalog-pull reconciliation (the core rule — replaces the blind overwrite)
For every product in the pulled snapshot:
```
local_stock(p) = server_stock(p) − Σ base_qty(p) over all sales with sync_status ∈ {pending, syncing, failed}
```
Rationale: `server_stock` already includes **synced** offline sales (don't subtract those); not-yet-confirmed sales are re-subtracted so local stays correct. This is a **pure recompute from a snapshot** — idempotent and self-healing regardless of push/pull ordering or crashes. Implemented as: upsert server stock, then subtract `getUnsyncedBaseQtyByProduct()`, all in one local transaction. Sync order is **push → pull** to shrink the transient window.

### 5.3 Backend: `/api/sync/sales` oversell-tolerant (additive, no migration)
`schemas/sync.py` already has `SyncWarning` + `SyncSaleResult.warnings` (unused); `api.ts` already has matching TS types. This wires the producers.

- **`services/inventory_ledger_service.py`**: add `allow_negative: bool = False` to `_apply_balance` and `allow_oversell: bool = False` to `consume_fifo`. When `available < quantity and allow_oversell`: consume all available layers at real FIFO cost, value the shortfall at `product.cost_price`, apply balance with `allow_negative=True` (stock may go negative, `inventory_value` clamped to 0, `cost_price` frozen). Extend `InventoryConsumption` additively with `shortfall_quantity`, `available_before`. **Defaults preserve online strictness byte-for-byte.**
- **`services/sync_service.py._create_sale`**: pass `allow_oversell=True`, collect `SyncWarning(type="oversell", ...)`, return `status="synced"` with `warnings` instead of `failed` on shortfall. Keep the `begin_nested()` savepoint for genuinely bad rows (product-not-found, negative total, idempotency conflict). Payment methods stay `cash|card|mobile`.
- **`api/sync.py`**: no signature change.

**Deliberate divergence (documented):** online `POST /api/sales` stays **strict** (rejects oversell); the **sync path is tolerant** because offline sales are immutable historical facts. This corrects the stale CLAUDE.md line claiming online overselling is allowed (see §8).

### 5.4 Cashier warnings surfaced
- At sale time: if any resulting `stock_quantity <= 0`, a non-blocking amber toast; POS grid styles `<0` red, `==0` amber.
- At sync time: `SyncSaleResult.warnings` → subtle amber note ("Синхронизировано, перерасход: N позиций").
- Low-stock threshold (`min_stock_level`) is **not** in the bootstrap payload in Phase 1; warn only on `<= 0`.

### 5.5 Cashier identity on offline sales (resolves the attribution gap)
`sales.cashier_user_id`/`cashier_username` are snapshotted locally from the **bound device identity** (`device_auth`). Server-side, `sync_service` assigns the cashier from the **bearer token's user** at sync time. Under the single-cashier-per-device constraint these are the same person, so attribution is consistent; the spec explicitly relies on that constraint and does not attempt server-side override from the local snapshot in Phase 1.

---

## 6. Backend additive changes `[backend]` — with backward-compat proofs

Phase-1 backend scope is deliberately **narrow**. Multi-UOM bootstrap (`units[]`, `product_unit_id`) and delta/`since` bootstrap are **cut from Phase 1** (see §11). Phase-1 backend changes:

### C0 — `server_time` on `SyncBootstrapResponse` (additive, no migration)
Add `server_time: datetime` (UTC now) to `SyncBootstrapResponse`. Gives the cashier a guaranteed source for `meta.server_time_offset_ms` (clock-skew correction over a week offline). **Proof:** new defaulted field on a response only the cashier consumes; web never calls bootstrap.

### C1 — oversell-tolerant sync (additive, no migration)
As in §5.3. **Proof:** `allow_oversell`/`allow_negative` default `False`, so online `POST /api/sales` and every other `consume_fifo` caller are unchanged; only the sync call opts in. `SyncWarning`/`warnings` already exist, so the response shape is unchanged — only previously-empty fields populate. A regression test asserts online strictness.

### C2 — device auth: `cashier_devices` table + router (MIGRATION REQUIRED)
Model `models/cashier_device.py`, schemas `schemas/device.py`, repo, service, router `api/device_auth.py` (registered in `main.py`), config default `DEVICE_TOKEN_EXPIRE_DAYS`. **Proof:** brand-new table/router/schema referenced by nothing existing; the minted token is a standard `token_type="access"` JWT, so `get_auth_context` and every `/api/sync/*` endpoint accept it unchanged and membership revocation still 401s. The unauthenticated `refresh` endpoint has **required** constant-time compare + rate limiting.

### C3 — `sales.client_sale_id` (MIGRATION REQUIRED, same file as C2)
`models/sale.py`: `client_sale_id = Column(String(64), nullable=True, index=True)`. Migration adds the column + a **partial unique index** `CREATE UNIQUE INDEX uq_sales_company_client_sale_id ON sales(company_id, client_sale_id) WHERE client_sale_id IS NOT NULL` — a DB-level dedupe backstop that leaves existing NULL rows untouched. `sync_service._create_sale` sets it; gives history a stable local↔server map and a second-line defense beyond the idempotency cache. `SaleResponse` optionally exposes it (default None). **Proof:** nullable column, partial index excludes existing NULL rows, online path leaves it NULL → no behavior change. **Verify** the `CREATE INDEX` (add `CONCURRENTLY` if run outside the migration transaction, or confirm the sales table is small enough) does not take a long `ACCESS EXCLUSIVE` lock during preDeploy.

### The ONE Alembic migration (C2 + C3)
A **single** migration `alembic/versions/20260710_XXXX-<newrev>_add_cashier_devices_and_sale_client_id.py` with `down_revision = "b2c3d4e5f6a7"` (the Railway-pinned live head): `create_table("cashier_devices")` + `add_column("sales","client_sale_id")` + the partial unique index. Do **NOT** `alembic merge` the two heads; leave the dead `20260319_0001` head untouched. **Bump the pinned rev in `railway.toml` and `railway.json` from `alembic upgrade b2c3d4e5f6a7` to `alembic upgrade <newrev>` in the SAME PR** — otherwise the table/column are never created in prod and the CI gate (`compileall`) will not catch it. Commit the migration file (migrations are **tracked**, not gitignored — see §8).

---

## 7. POS Kassa UI — parity + polish `[ui-pos]`

A two-pane fixed-window register that matches/exceeds the web POS, built on the local model above.

### 7.1 Layout & visual DNA
`flex h-screen flex-col`; left `main` (search + barcode + category chips + `grid-cols-3 xl:grid-cols-4` `rounded-3xl h-36` tiles with live stock badges); right `aside` `w-[420px]` cart panel (line edits, totals, bottom pay bar). No mobile sheet, no bottom bar, no resize handle (single fixed desktop window). Reuse the web's exact Tailwind language: `rounded-3xl/2xl/xl`, `tabular-nums` money, blue-600 primary, green pay gradient, amber offline/credit, red destructive, full `dark:` variants (Tailwind v4 `@custom-variant dark`), Inter via bundled `@fontsource/inter` (no CDN in Tauri), Heroicons, `react-hot-toast`.

### 7.2 Copy framework-agnostic helpers verbatim (no math drift)
Copy `posStock.ts`, `posPricing.ts`, `posUnits.ts` (retyped to `LocalProduct`/`LocalProductUnit` only) from `sellary-frontend/src/lib/`; add a minimal `format.ts` (`formatCurrency` UZS `ru-RU`). Do **not** copy `useCartStore`/`utils.ts` (Next/TanStack coupling). Write a small `cart-store.ts` (single cart, no multi-session): `items: CartLine[]`, actions `addItem/removeItem/updateQuantity/changeUnit/setDiscount/clearCart`, selectors `getSubtotal/getTax`, line identity `cartLineKey(productId, unit.id)`.

### 7.3 Optimistic completion (the stability win)
On pay-confirm, do these **synchronously and locally**, in order: (1) build payload; (2) `insertSale(...)` (atomic outbox row + base-unit stock decrement, §2.9); (3) `clearCart()` + reset modal; (4) `toast.success('Продажа завершена')`; (5) refocus barcode. **Then** `requestSync('post-sale')` **without awaiting**. The pay button never spins on the network; a sale is done the instant it hits local SQLite.

### 7.4 Payment scope (Phase 1)
Offline-capable: **Наличные (cash)**, **Карта (card + alif/eskhata/dc)**, **Мобильный (mobile)** — all route through the outbox → `POST /api/sync/sales` (`cash|card|mobile`). **payment_method/card_type are written canonical lowercase** (fixes latent casing inconsistency; note this is a normalization, not a live sync-break fix — `sync_service` already lowercases). **В долг (credit)** is rendered but **disabled** with an amber "internet kerak" hint (no credit in the sync API; Phase 2). No offline returns.

### 7.5 Multi-UOM: dormant in Phase 1
The unit picker code path is **present but dormant**: `hasMultipleUnits(product)` returns `false` while `product_units` is empty, so the register runs base-unit-only with zero regressions. It lights up automatically in Phase 2 once the additive backend `units[]` bootstrap field and local `product_units` population land. This honors the fixed "NO multi-UOM in Phase 1" scope while keeping the schema and helpers ready. (Sync stays unchanged: a unit line would convert to base — `quantity ×= factor`, `sell_price /= factor` — preserving line revenue with no sync-endpoint change.)

### 7.6 Keyboard, states, guards
F2 → barcode; Enter → open/confirm payment; Esc → close; barcode scanner lands in the barcode input. Skeletons on first bootstrap only; empty-cart / empty-catalog states; persistent amber offline strip ("Оффлайн — продажи сохраняются локально"); header `Не отправлено: N` badge from `sync-store`; **guarded logout** (§10).

---

## 8. Sales History UI (new) `[ui-history]`

A "История продаж" screen built entirely on the **local `sales` + `sale_items`** model (the same rows the sync worker reads — one source of truth, no `outbox_sales.request_json` parsing, no `receipt_json` blob).

### 8.1 Layout (mirrors web, adapted)
- **Sync-status tabs** replace web's completed/returns/cancelled (no local returns/void): `Все` | `Синхронизировано` (`synced`) | `Не синхронизировано` (`pending`+`syncing`+transient `failed`) | `Требует внимания` (permanent `failed`).
- Search + payment/date FilterMenu + a Sync/Refresh button (calls the engine).
- **KPI cards:** `Оборот` / `Чеков` / `Средний чек` (verbatim web) + a cashier-unique `Не синхронизировано` card (amber if >0; click → filters to that tab). Computed as **SQL aggregates over the whole active filter** (`getHistoryAggregates`), not just the loaded page.
- **Hourly chart** 08:00–22:00 from `created_at_client`.
- **Sales table:** `Чек` (short `client_sale_id`/`receipt_no`, mono) · `Время` · `Оплата` (PaymentChip, case-insensitive) · `Сумма` · **`Синхронизация`** (SyncStatusBadge) · row-click → detail. `Показать ещё` load-more (`LIMIT/OFFSET`, `created_at_client DESC`).

Because receipt fields (`product_name`, `uom`, `tax_percent`, `line_subtotal`, `line_total`, cashier) are **stored structured** on `sale_items`/`sales`, the receipt is drift-proof — no render-time reconstruction from the `products` table, no "unknown product" after a delete.

### 8.2 Detail slide-over
Header (`Чек #<receipt_no>` · time · SyncStatusBadge); items (name × qty uom × unit_price = line total); totals (Подытог/Скидка/Налог/Итого/Оплата + cash received & change); a **sync-state box** — synced (server `#sale_id` + `synced_at`), amber "Ожидает синхронизации", or red error box with `last_error` and a **"Повторить"** button that calls `requestSync`. **`Печать чека`** reprint always. **NO** return/void/debt buttons — a muted note "Возвраты и долги доступны в веб-версии (нужен интернет)".

### 8.3 Failed-sync alert
A `permanent` failure means the server rejected a sale whose cash + local stock already moved (e.g., product deleted server-side → "Products not found"). The detail panel surfaces this **loudly** as a business alert, not a cosmetic badge.

### 8.4 Needs-attention ownership (resolves the double-owner conflict)
- **History `SaleDetailPanel`** offers a single-sale **"Повторить"** (retry) action.
- **`SettingsPage`** owns the authoritative **needs-attention management list** (force-resend with the same `idempotency_key`, or acknowledge). **Deleting a recorded sale is NOT offered in Phase 1** (compliance concern); the only actions are resend and acknowledge. This gives one management home and one retry affordance without duplication.

---

## 9. Missing UI states (designed, resolving the gaps)

- **Offline first-run (blocked):** no `device_auth` + no network → full-screen "Для первой настройки нужен интернет. Подключитесь и войдите." No catalog, no sell. Only appears before the one-time provisioning.
- **PIN lockout:** after 5 fails, a countdown screen "Слишком много попыток. Попробуйте через M:SS." driven by `locked_until`.
- **PIN forgotten / recovery:** a link "Забыли PIN? Войдите через интернет" → online login → select-company → silent re-register → PinSetup. Offline + forgotten PIN = locked out (accepted).
- **`needsReauth` banner** (device_token expired > 180 d OR membership revoked while offline): non-blocking amber top banner "Требуется вход через интернет" — **selling still works into the outbox**, the badge keeps growing, nothing is auto-wiped.
- **Stale-catalog warning:** when `now − last_catalog_pull_at > 3 days`, a subtle amber chip "Каталог обновлён N дн. назад" (prices/stock may be stale).
- **Oversold cart state:** POS grid `<0` red / `==0` amber; the cart line driving stock negative shows an inline amber strip; the payment modal is not blocked (sale is a historical fact).
- **Partial-batch sync result:** explicit toast copy "Отправлено N · требует внимания M" when a push returns mixed results.
- **Logout-while-permanent-failure modal:** see §10.

---

## 10. Logout gating (resolves the contradiction)

- **Hard-block** logout while **unsynced** (`pending` + `syncing` + transient `failed`) rows exist → toast "Есть N неотправленных продаж. Дождитесь синхронизации." and trigger `syncNow()`.
- **Do NOT permanently trap** the cashier behind a `permanent` needs_attention sale (it can never self-resolve, e.g., product deleted server-side). If **only** `needsAttentionCount>0` → a **confirm modal**: "M продаж не удалось отправить, они останутся на устройстве. Выйти?" and allow proceed. On logout, clear device + PIN + session.

---

## 11. Phasing

### Phase 1 — Foundation (this spec's runtime path)
- **Offline auth:** `cashier_devices` + `/api/auth/devices/{register,refresh,revoke,list}`, local argon2id PIN, PIN setup/unlock/lockout/recovery/needsReauth UI, provisioning order, offline-first-run screen.
- **Local model:** unified `sales` + `sale_items` (migration `002`), `device_auth`, reserved (empty) `product_units` + reserved `sale_items` UOM columns, backfill with corrected `stock_applied`, `reconcileLocalState`.
- **Local stock:** immediate atomic decrement + catalog reconcile (`local = server − Σ unsynced`), shipped **together**.
- **Oversell-tolerant sync:** additive `allow_oversell` on the sync path; online path stays strict; `SyncWarning` surfaced.
- **Background sync engine:** triggers, single-flight+coalescing, transient/permanent classification, backoff, crash recovery, `sync-store`.
- **POS parity:** two-pane register, copied pricing/stock helpers, optimistic completion, **cash/card/mobile**; credit visible-but-disabled; multi-UOM **dormant** (base-unit only).
- **Sales-History (local):** tabs/KPIs/chart/table/detail/reprint over the local model.
- **Backend additive:** C0 `server_time`, C1 oversell tolerance, C2 device auth, C3 `client_sale_id`; one Alembic migration + railway pin bump.

### Phase 2 — Richer offline + coupled features
- **Offline credit + offline returns** (needs new sync contract + local schema; currently online-only "internet kerak").
- **Multi-UOM lit up:** additive `units[]` + `min_stock_level` on `SyncProductItem` bootstrap; `product_unit_id` on `SyncSaleItemCreate` (base-unit conversion until then); populate local `product_units`; enable the picker.
- **Server-history merge** in History (dedup by `sales.client_sale_id` / `server_sale_id`) via existing `GET /api/sales`.
- Optional `min_stock_level` low-stock badge; optional delta bootstrap (only if profiling ever justifies it — currently a non-goal).

---

## 12. Backward-compatibility & migration discipline

- **All backend changes are additive:** new tables (`cashier_devices`), new nullable column (`sales.client_sale_id`), new defaulted response fields (`server_time`), new router, new optional JWT `device_id` claim, and previously-empty `SyncWarning` fields now populated. No column/endpoint/enum renamed, removed, or semantically changed. The device token is a standard `token_type="access"` JWT accepted by `get_auth_context` unchanged.
- **Online `POST /api/sales` is byte-for-byte unchanged:** oversell tolerance is gated behind `allow_oversell=False` defaults; a regression test asserts online strictness and that all other `consume_fifo` callers are unaffected.
- **Exactly ONE new Alembic head**, chained off the Railway-pinned `b2c3d4e5f6a7`. **No `alembic merge`.** The pinned rev in `railway.toml` **and** `railway.json` is bumped in the **same PR** — the single highest-risk operational step (CI's `compileall` gate cannot catch a missed pin bump). The dead `20260319_0001` head is left untouched.
- **Local SQLite migration `002` is strictly additive** (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX` only), forward-only alongside untouched `001`. `outbox_sales` is copied (idempotent, flag-guarded) and never mutated or dropped, so re-run and fresh-install both behave.
- **Negative-stock ripple audit (required before enabling sync oversell):** negative `products.stock_quantity` is a new server state. Audit the **web** product listings, dashboards, low-stock alerts, and reports for `stock >= 0` assumptions; they are display-only but may render/aggregate negatives.
- **Stale-doc fixes shipped with this work:** correct CLAUDE.md's "migrations are gitignored" (they are **tracked**) and "online overselling is allowed" (online now **rejects**; only the sync path tolerates). Both stale facts directly threaten the deploy and the oversell design.
- **Tax-recompute drift (documented, not a bug):** the server recomputes tax from the current `product.tax_percent` at sync time; a tax-rate change during a long offline stretch makes synced tax differ slightly from the printed receipt. Revenue (`sell_price`) is frozen and correct. Note in ops docs.

---

## 13. Non-goals / YAGNI

- **NO multi-device conflict resolution / CRDT.** Single device per shop.
- **NO online-session gate on app-open.** PIN + registered device gate the app; the access_token is a disposable sync credential.
- **NO offline credit or offline returns in Phase 1.** Online-only, shown as "internet kerak".
- **NO delta/`since` bootstrap.** Full refresh is fine for < 1000 products (fixed decision; not relitigated).
- **NO active multi-UOM in Phase 1.** Schema/helpers reserved; picker dormant until the additive backend field lands.
- **NO `request_json`/`receipt_json` blob.** Structured columns are the single source of truth.
- **NO `token_version` + `revoked_at` duplication.** One `is_active` kill-switch.
- **NO sliding-window bookkeeping beyond `expires_at` sliding-renew-on-refresh.** One long expiry + opportunistic refresh-on-reconnect covers the week-offline requirement.
- **NO deletion of recorded sales** from the needs-attention list (compliance).

---

## 14. Testing

### Backend (`tests/integration`, transaction-rollback isolation, `session.flush()` not commit)
1. `sync/sales` oversell → `status="synced"` + `SyncWarning`; **regression: online `POST /api/sales` and all other `consume_fifo` callers still strict** (assert `allow_oversell=False` default path raises).
2. Device `register` (any company member) → device_token once; prior active device deactivated (1/shop); `refresh` mints a 24h access_token, sliding-renews `expires_at`, bumps `last_seen_at`.
3. `refresh` rejects: bad token (constant-time), inactive device, expired, **revoked membership → 403**; rate-limited by device_id/IP.
4. `client_sale_id` persisted; re-sync same `client_sale_id` → `duplicate`; partial unique index blocks a duplicate insert but leaves NULL online rows unconstrained.
5. Bootstrap returns `server_time`; existing fields unchanged.
6. Alembic `upgrade <newrev>` → `downgrade` round-trips (table + column + index dropped); exactly one head.

### Cashier (vitest; extend `sync-service.test.ts`)
1. `insertSale` atomicity: children-first/parent-last; crash between parent-insert and decrement heals via `reconcileLocalState` (exactly-once stock).
2. Reconcile invariant: `local = server − Σ unsynced`; running twice is idempotent; push-before-pull and pull-before-push both converge (no double-count).
3. Backfill: legacy `pending`/`failed` rows → `stock_applied=0` then decremented by reconcile; legacy `synced` → `stock_applied=1` (no double-decrement); malformed `request_json` skipped per-row with a logged `sync_event`; re-run is a no-op (`outbox_migrated_v2`).
4. Sync engine: single-flight + coalescing (burst → one pass); classification (server-error → permanent/no-retry; network → transient/backoff); `recoverSyncingSales` on restart; backoff schedule + earliest-`next_attempt_at` timer.
5. Badge/gate math: `unsyncedCount` excludes permanent; logout hard-blocks on unsynced, confirm-modal on permanent-only.
6. PIN: argon2id hash/verify round-trip (Rust command), constant-time verify, lockout after 5 fails, `locked_until` countdown.
7. `restoreSession` opens the app on an **expired** access_token when `hasDevice && hasPin`.
8. POS pricing/stock parity vs copied web helpers (golden cases: change, discount, over-stock, tax).
9. History aggregates over the full filter (not just the page); receipt renders from structured snapshot after a product delete.

### CI gate
`python -m compileall api core models repositories schemas services main.py` must pass (every new backend module imports cleanly and registers in `main.py`). Confirm the `argon2` Rust command builds on `windows-latest`.

---

## 15. Open questions for the user

1. **Device provisioning authority:** confirm a **cashier-role** token may self-register on first run (this spec allows it), or should registration be admin/manager-only (which would require an admin present at every shop's first setup)?
2. **PIN policy:** 4- vs 6-digit PIN, and confirm the 5-attempt → exponential-backoff lockout curve. Should exceeding lockout force an online re-login rather than a timed unlock?
3. **`DEVICE_TOKEN_EXPIRE_DAYS = 180`** and sliding-renewal-on-refresh, with a ~12 h near-expiry refresh window — confirm.
4. **Needs-attention actions:** confirm Phase-1 offers only **resend + acknowledge** (no delete). Is "acknowledge" (hide from the count while keeping the row) acceptable for un-syncable sales, and should such a row still block logout?
5. **Negative-stock web audit:** who owns verifying the web product lists/dashboards/reports before we enable sync oversell? This must land before or with C1.
6. **Oversell valuation:** value the shortfall at the running `product.cost_price` (this spec) or at 0 cost (conservative) until a later purchase backfills? Affects COGS/margin on offline oversells.
7. **`client_sale_id` on `SaleResponse`:** expose now (so the web can show device-origin) or keep internal in Phase 1?
8. **History retention:** keep all synced local sales forever, or prune/archive synced rows older than N days to bound local DB growth?
9. **Reprint target:** browser/webview `window.print()` only, or must it drive a real thermal/ESC-POS printer (a Tauri command, not `window.print`)?
10. **Owner panel surface:** should `/api/auth/devices` management appear in the global owner panel, the company admin UI, or both?
