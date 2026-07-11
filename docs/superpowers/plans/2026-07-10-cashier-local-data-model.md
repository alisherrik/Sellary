# Cashier Local Data Model + Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Land the unified local SQLite `sales`/`sale_items`/`product_units`/`device_auth` schema (local migration `002`), rewrite the `db.ts` data-access surface exactly per spec §2.10 with crash-safe immediate base-unit stock decrement, and add the reconciling catalog upsert (`local = server − Σ unsynced`) plus the idempotent `outbox_sales → sales` backfill.

**Architecture:** One additive local migration (`002_local_first.sql`, DDL-only `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX`) registered as `Migration { version: 2 }` in `src-tauri/src/lib.rs`. `db.ts` becomes the single source of truth for both the sync worker (rows filtered by `sync_status`) and the Sales-History screen (same rows joined with `sale_items`). Stock decrements exactly-once at insert time, flagged by `stock_applied`, healed on restart by `reconcileLocalState()`. Tests run in vitest against a real in-memory SQLite (`better-sqlite3`) mounted behind a fake `@tauri-apps/plugin-sql` `Database`, so atomicity/reconcile/backfill invariants are exercised with real SQL semantics.

**Tech Stack:** TypeScript, `@tauri-apps/plugin-sql` (SQLite) in prod; `better-sqlite3` in-memory in tests; Rust `tauri-plugin-sql` migrations; vitest.

**Depends on:** none (per INDEX §1; data-model and backend are the two roots). **Consumed by** plan 3 (offline-auth), plan 4 (sync-engine), plan 5 (POS Kassa UI), plan 6 (Sales History UI) — those import the DAO signatures defined here verbatim from spec §2.10 and the INDEX §4 canonical contract. Do NOT change a signature without updating the INDEX contract + spec.

---

## Scope guardrails (read before starting)

- **Purely additive to `db.ts` + one behavior swap.** This plan **keeps** the legacy outbox API (`addToOutbox`, `getPendingSales`, `getOutboxSaleById`, `updateOutboxStatus`, `markOutboxSalesFailed`, `recoverSyncingSales(error)`, `OutboxSale`, `decrementLocalStock`, `LocalStockChange`) **in place**. `sync-service.ts` and `POSPage.tsx` still import them and must keep compiling. Their removal is owned by the sync-engine plan (plan 4) and the POS-UI plan (plan 5), which rewrite those callers. Deleting them here would break the tree and this plan's own green bar. Spec §2.10's "Remove the outbox-only API" is satisfied across plans 2+4+5, not in this plan alone. (See open questions.)
- **`recoverSyncingSales` name clash:** the legacy `recoverSyncingSales(error?: string)` operates on `outbox_sales`. The new spec-§2.10 `recoverSyncingSales(nowIso: string)` operates on `sales`. Same name, different table, different signature. To avoid a collision while both tables live, the **new** one is named `recoverSyncingSales` and the **legacy** one is renamed in-place to `recoverSyncingOutboxSales` (its only caller, `sync-service.ts`, and its only test reference are updated in the same commit). This keeps spec §2.10's public name correct for downstream plans.
- **`upsertProducts` keeps its exact signature** `(products: LocalProduct[]) => Promise<void>` — only its body changes to the reconciling recompute. `auth-store.ts` and `POSPage.tsx` call sites are unchanged.
- **No source edits outside `db.ts`, the two migration files, `lib.rs`, and the one legacy-rename touch to `sync-service.ts` + its test.** No UI, no engine, no backend.

---

## File Structure

**Create**
- `sellary-cashier/src-tauri/migrations/002_local_first.sql` — additive DDL: `sales`, `sale_items`, `product_units`, `device_auth`, hot-path indexes (spec §2.3–§2.6).
- `sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts` — test helper: in-memory `better-sqlite3` behind a fake plugin-sql `Database`; applies `001` + `002`.
- `sellary-cashier/src/lib/__tests__/db-migration.test.ts` — migration `002` schema assertions.
- `sellary-cashier/src/lib/__tests__/db-insert-sale.test.ts` — `insertSale` atomicity + exactly-once decrement.
- `sellary-cashier/src/lib/__tests__/db-reconcile.test.ts` — `reconcileLocalState` orphan-sweep + idempotent decrement.
- `sellary-cashier/src/lib/__tests__/db-sync-dao.test.ts` — sendable (default + `includePermanent`)/mark*/counts/`acknowledgeSale`/`getUnsyncedBaseQtyByProduct`.
- `sellary-cashier/src/lib/__tests__/db-catalog-reconcile.test.ts` — `local = server − Σ unsynced` invariant + idempotency + order-independence.
- `sellary-cashier/src/lib/__tests__/db-history.test.ts` — `getSalesHistory` / `getHistoryAggregates` / `getSaleWithItems`.
- `sellary-cashier/src/lib/__tests__/db-device-auth.test.ts` — device-auth single-row DAO.
- `sellary-cashier/src/lib/__tests__/db-backfill.test.ts` — `migrateOutboxToSalesOnce` corrected `stock_applied` + idempotency + malformed-row skip.

**Modify**
- `sellary-cashier/src-tauri/src/lib.rs:15-23` — register `Migration { version: 2, ... }`.
- `sellary-cashier/src/lib/db.ts` — new types + full DAO surface (spec §2.10); reconciling `upsertProducts`; rename legacy `recoverSyncingSales` → `recoverSyncingOutboxSales`.
- `sellary-cashier/src/lib/sync-service.ts` — update the single `recoverSyncingSales` call to `recoverSyncingOutboxSales` (mechanical rename only).
- `sellary-cashier/src/lib/__tests__/sync-service.test.ts` — mock key rename `recoverSyncingSales` → `recoverSyncingOutboxSales`.
- `sellary-cashier/package.json` — add `better-sqlite3` + `@types/better-sqlite3` devDependencies.

---

## Task 1: Local migration `002` + Rust registration + test harness

**Files:**
- Modify: `sellary-cashier/package.json` (devDependencies)
- Create: `sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts`
- Create: `sellary-cashier/src-tauri/migrations/002_local_first.sql`
- Modify: `sellary-cashier/src-tauri/src/lib.rs:15-23`
- Create: `sellary-cashier/src/lib/__tests__/db-migration.test.ts`

- [ ] **Add the test-only SQLite engine.** Run from `sellary-cashier/`:
  ```
  npm install -D better-sqlite3@^11.8.0 @types/better-sqlite3@^7.6.11
  ```
  Confirm `package.json` `devDependencies` now lists both. (This engine is test-only; production still uses `@tauri-apps/plugin-sql`.)

- [ ] **Write the fake-DB harness** `sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts`. It applies `001_init.sql` + `002_local_first.sql` into an in-memory better-sqlite3 DB and exposes the exact `execute`/`select` surface `db.ts` calls, converting `$N` placeholders to positional `?`:
  ```ts
  import BetterSqlite3 from 'better-sqlite3';
  import fs from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(dir, '../../../../src-tauri/migrations');

  function normalize(args: unknown[]): unknown[] {
    return args.map((a) => {
      if (typeof a === 'boolean') return a ? 1 : 0;
      if (a === undefined) return null;
      return a;
    });
  }

  function toPositional(sql: string, params: unknown[]): { sql: string; args: unknown[] } {
    const args: unknown[] = [];
    const converted = sql.replace(/\$(\d+)/g, (_m, d) => {
      args.push(params[Number(d) - 1]);
      return '?';
    });
    return { sql: converted, args: normalize(args) };
  }

  export class FakeDatabase {
    constructor(private raw: BetterSqlite3.Database) {}

    async execute(sql: string, params: unknown[] = []) {
      const { sql: s, args } = toPositional(sql, params);
      const info = this.raw.prepare(s).run(...args);
      return { lastInsertId: Number(info.lastInsertRowid), rowsAffected: info.changes };
    }

    async select<T>(sql: string, params: unknown[] = []): Promise<T> {
      const { sql: s, args } = toPositional(sql, params);
      return this.raw.prepare(s).all(...args) as T;
    }

    seedProduct(p: { id: number; name?: string; barcode?: string | null; sell_price?: number; stock_quantity?: number; tax_percent?: number; uom?: string }) {
      this.raw.prepare(
        `INSERT INTO products (id, barcode, name, uom, category_id, sell_price, tax_percent, stock_quantity, is_active, updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,'2025-01-01T00:00:00.000Z')`
      ).run(p.id, p.barcode ?? null, p.name ?? `P${p.id}`, p.uom ?? 'pcs', null, p.sell_price ?? 10, p.tax_percent ?? 0, p.stock_quantity ?? 100);
    }

    stockOf(productId: number): number {
      const row = this.raw.prepare('SELECT stock_quantity AS s FROM products WHERE id = ?').get(productId) as { s: number } | undefined;
      return row?.s ?? 0;
    }
  }

  export function createTestDb(): FakeDatabase {
    const raw = new BetterSqlite3(':memory:');
    const sql001 = fs.readFileSync(path.join(migrationsDir, '001_init.sql'), 'utf8');
    const sql002 = fs.readFileSync(path.join(migrationsDir, '002_local_first.sql'), 'utf8');
    raw.exec(sql001);
    raw.exec(sql002);
    return new FakeDatabase(raw);
  }
  ```

- [ ] **Write the failing schema test** `sellary-cashier/src/lib/__tests__/db-migration.test.ts` (fails now: `002_local_first.sql` does not exist yet, so `createTestDb()` throws `ENOENT`):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  async function tableNames(db: FakeDatabase): Promise<string[]> {
    const rows = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    return rows.map((r) => r.name);
  }
  async function indexNames(db: FakeDatabase): Promise<string[]> {
    const rows = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
    );
    return rows.map((r) => r.name);
  }

  describe('migration 002_local_first', () => {
    it('creates the local-first tables additively without touching 001 tables', async () => {
      const db = createTestDb();
      const tables = await tableNames(db);
      expect(tables).toEqual(expect.arrayContaining([
        'sales', 'sale_items', 'product_units', 'device_auth',
        'products', 'categories', 'outbox_sales', 'meta', 'sync_events',
      ]));
    });

    it('creates the hot-path indexes', async () => {
      const db = createTestDb();
      const idx = await indexNames(db);
      expect(idx).toEqual(expect.arrayContaining([
        'idx_sales_sync_status', 'idx_sales_created_desc', 'idx_sales_receipt_no',
        'idx_sale_items_sale_id', 'idx_product_units_product',
        'idx_products_barcode', 'idx_products_name',
      ]));
    });

    it('enforces device_auth single-row CHECK (id = 1)', async () => {
      const db = createTestDb();
      await db.execute("INSERT INTO device_auth (id, device_id) VALUES (1, 'dev-1')");
      await expect(
        db.execute("INSERT INTO device_auth (id, device_id) VALUES (2, 'dev-2')")
      ).rejects.toThrow();
    });

    it('enforces sales.sync_status CHECK set (no duplicate)', async () => {
      const db = createTestDb();
      await expect(
        db.execute(
          `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, created_at_client)
           VALUES (1, 'c1', 'i1', 1, 'cash', 'duplicate', '2025-01-01T00:00:00.000Z')`
        )
      ).rejects.toThrow();
    });
  });
  ```

- [ ] **Run it and see it FAIL.** From `sellary-cashier/`:
  ```
  npx vitest run src/lib/__tests__/db-migration.test.ts
  ```
  Expected failure: `ENOENT: no such file or directory, open '.../src-tauri/migrations/002_local_first.sql'`.

- [ ] **Create `sellary-cashier/src-tauri/migrations/002_local_first.sql`** with the exact spec DDL (§2.3–§2.6), additive only:
  ```sql
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
  ```

- [ ] **Register the migration in Rust.** Edit `sellary-cashier/src-tauri/src/lib.rs` lines 15-23, replacing the single-element `vec![Migration { version: 1, ... }]` with:
  ```rust
                  .add_migrations(
                      "sqlite:sellary_cashier.db",
                      vec![
                          Migration {
                              version: 1,
                              description: "initial schema",
                              sql: include_str!("../migrations/001_init.sql"),
                              kind: MigrationKind::Up,
                          },
                          Migration {
                              version: 2,
                              description: "local-first sales, history, device auth",
                              sql: include_str!("../migrations/002_local_first.sql"),
                              kind: MigrationKind::Up,
                          },
                      ],
                  )
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-migration.test.ts
  ```
  All four cases green.

- [ ] **Manual Rust gate (note, do not automate):** the `include_str!("../migrations/002_local_first.sql")` change only compiles inside a Rust build. Reviewer runs `npm run tauri:dev` (requires the Rust toolchain) once to confirm the app boots and applies migration `2`. Not part of the vitest CI gate.

- [ ] **Commit:**
  ```
  git add sellary-cashier/package.json sellary-cashier/package-lock.json \
          sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts \
          sellary-cashier/src-tauri/migrations/002_local_first.sql \
          sellary-cashier/src-tauri/src/lib.rs \
          sellary-cashier/src/lib/__tests__/db-migration.test.ts
  git commit -m "feat(cashier): add local-first migration 002 and in-memory sqlite test harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: `db.ts` types + `insertSale` (crash-safe, immediate base-unit decrement)

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts` (append types + `insertSale`/`insertSaleRaw`/internal `applyStockForSale`/`attachItems`)
- Create: `sellary-cashier/src/lib/__tests__/db-insert-sale.test.ts`

- [ ] **Write the failing test** `sellary-cashier/src/lib/__tests__/db-insert-sale.test.ts`. It mounts the fake DB behind `@tauri-apps/plugin-sql` and re-imports `db.ts` fresh per test (fails now: `insertSale` is not exported):
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({
    default: { load: async () => fake },
  }));

  let db: typeof import('../db');

  function saleInput(over: Partial<import('../db').NewSaleInput> = {}): import('../db').NewSaleInput {
    return {
      client_sale_id: over.client_sale_id ?? 'c-1',
      idempotency_key: over.idempotency_key ?? 'i-1',
      subtotal: over.subtotal ?? 30,
      discount_amount: over.discount_amount ?? 0,
      tax_amount: over.tax_amount ?? 0,
      total_amount: over.total_amount ?? 30,
      paid_amount: over.paid_amount ?? 30,
      change_amount: over.change_amount ?? 0,
      payment_method: over.payment_method ?? 'cash',
      card_type: over.card_type ?? null,
      notes: over.notes ?? null,
      cashier_user_id: over.cashier_user_id ?? 7,
      cashier_username: over.cashier_username ?? 'kassa',
      created_at_client: over.created_at_client ?? '2025-01-01T08:00:00.000Z',
      items: over.items ?? [
        { product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 3,
          unit_price: 10, tax_percent: 0, line_subtotal: 30, line_total: 30, sort_order: 0 },
      ],
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    fake.seedProduct({ id: 1, stock_quantity: 100 });
    fake.seedProduct({ id: 2, stock_quantity: 50 });
    db = await import('../db');
  });

  describe('insertSale', () => {
    it('assigns MAX(id)+1 and MAX(receipt_no)+1 on the single device', async () => {
      const a = await db.insertSale(saleInput({ client_sale_id: 'c-1' }));
      const b = await db.insertSale(saleInput({ client_sale_id: 'c-2', idempotency_key: 'i-2' }));
      expect(a).toEqual({ saleId: 1, receiptNo: 1 });
      expect(b).toEqual({ saleId: 2, receiptNo: 2 });
    });

    it('inserts children then parent and decrements base-unit stock, flagging stock_applied=1', async () => {
      await db.insertSale(saleInput());
      expect(fake.stockOf(1)).toBe(97); // 100 - 3
      const sale = await db.getSaleWithItems(1);
      expect(sale?.stock_applied).toBe(1);
      expect(sale?.items).toHaveLength(1);
      expect(sale?.items[0].quantity).toBe(3);
      expect(sale?.sync_status).toBe('pending');
    });

    it('exactly-once: a crash between parent-insert and decrement heals via reconcileLocalState', async () => {
      // Simulate the crash: raw children-first + parent with stock_applied=0, no decrement.
      await fake.execute(
        `INSERT INTO sale_items (sale_id, product_id, product_name, uom, quantity, unit_price, line_subtotal, line_total, sort_order)
         VALUES (1, 2, 'B', 'pcs', 5, 10, 50, 50, 0)`
      );
      await fake.execute(
        `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, stock_applied, created_at_client)
         VALUES (1, 'crash', 'i-crash', 1, 'cash', 'pending', 0, '2025-01-01T08:00:00.000Z')`
      );
      expect(fake.stockOf(2)).toBe(50); // not yet decremented
      await db.reconcileLocalState();
      expect(fake.stockOf(2)).toBe(45); // healed exactly once
      await db.reconcileLocalState();
      expect(fake.stockOf(2)).toBe(45); // idempotent — no double decrement
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/lib/__tests__/db-insert-sale.test.ts
  ```
  Expected failure: `db.insertSale is not a function` (and `getSaleWithItems`/`reconcileLocalState` undefined).

- [ ] **Add the types and write path to `db.ts`.** Append after the existing `LocalCategory` block (keep all existing exports intact). First the types:
  ```ts
  // ---------------------------------------------------------------------------
  // Local-first model (migration 002) — spec §2.3–§2.10
  // ---------------------------------------------------------------------------

  export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';
  export type ErrorKind = 'transient' | 'permanent';

  export interface NewSaleItemInput {
    product_id: number;
    product_name: string;
    barcode: string | null;
    uom: string;
    quantity: number;      // BASE units
    unit_price: number;
    tax_percent: number;
    line_subtotal: number;
    line_total: number;
    sort_order: number;
  }

  export interface NewSaleInput {
    client_sale_id: string;
    idempotency_key: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    payment_method: string;      // canonical lowercase: 'cash'|'card'|'mobile'
    card_type: string | null;    // 'alif'|'eskhata'|'dc'|null
    notes: string | null;
    cashier_user_id: number | null;
    cashier_username: string | null;
    created_at_client: string;   // ISO
    items: NewSaleItemInput[];
  }

  export interface LocalSale {
    id: number;
    client_sale_id: string;
    idempotency_key: string;
    receipt_no: number;
    server_sale_id: number | null;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    payment_method: string;
    card_type: string | null;
    notes: string | null;
    cashier_user_id: number | null;
    cashier_username: string | null;
    sync_status: SyncStatus;
    error_kind: ErrorKind | null;
    next_attempt_at: string | null;
    first_failed_at: string | null;
    last_error: string | null;
    retry_count: number;
    stock_applied: number;
    acknowledged: number;
    created_at_client: string;
    synced_at: string | null;
    updated_at: string;
  }

  export interface LocalSaleItem {
    id: number;
    sale_id: number;
    product_id: number;
    product_name: string;
    barcode: string | null;
    uom: string;
    quantity: number;
    unit_price: number;
    tax_percent: number;
    line_subtotal: number;
    line_total: number;
    sort_order: number;
    product_unit_id: number | null;
    sold_unit_label: string | null;
    sold_unit_factor: number | null;
    sold_quantity: number | null;
  }

  export interface SaleWithItems extends LocalSale {
    items: LocalSaleItem[];
  }

  export interface LocalProductUnit {
    id: number;
    product_id: number;
    name: string;
    factor: number;
    sell_price: number | null;
    barcode: string | null;
    is_active: number;
    sort_order: number;
    updated_at: string | null;
  }

  // Full sales-row shape used by insertSaleRaw (id + receipt_no are computed).
  interface RawSaleRow {
    client_sale_id: string;
    idempotency_key: string;
    server_sale_id: number | null;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    payment_method: string;
    card_type: string | null;
    notes: string | null;
    cashier_user_id: number | null;
    cashier_username: string | null;
    sync_status: SyncStatus;
    error_kind: ErrorKind | null;
    next_attempt_at: string | null;
    first_failed_at: string | null;
    last_error: string | null;
    retry_count: number;
    synced_at: string | null;
    created_at_client: string;
  }
  ```

- [ ] **Add the internal stock helper + `insertSaleRaw` + public `insertSale` + `attachItems`** to `db.ts`:
  ```ts
  // Internal: decrement base-unit stock for every line of a sale, then flag stock_applied=1.
  async function applyStockForSale(saleId: number): Promise<void> {
    const database = await getDb();
    const items = await database.select<{ product_id: number; quantity: number }[]>(
      'SELECT product_id, quantity FROM sale_items WHERE sale_id = $1',
      [saleId]
    );
    for (const it of items) {
      await database.execute(
        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [it.quantity, it.product_id]
      );
    }
    await database.execute(
      "UPDATE sales SET stock_applied = 1, updated_at = datetime('now') WHERE id = $1",
      [saleId]
    );
  }

  // Crash-safe insert: children first (orphan-swept by reconcile), parent last (atomic commit
  // point), then decrement when decrementNow. Reused by insertSale and the backfill.
  async function insertSaleRaw(
    raw: RawSaleRow,
    items: NewSaleItemInput[],
    stockApplied: number,
    decrementNow: boolean
  ): Promise<{ saleId: number; receiptNo: number }> {
    const database = await getDb();
    const idRows = await database.select<{ maxId: number | null }[]>('SELECT MAX(id) AS maxId FROM sales');
    const nextId = (idRows[0]?.maxId ?? 0) + 1;
    const rcRows = await database.select<{ maxRc: number | null }[]>('SELECT MAX(receipt_no) AS maxRc FROM sales');
    const nextReceipt = (rcRows[0]?.maxRc ?? 0) + 1;

    for (const it of items) {
      await database.execute(
        `INSERT INTO sale_items
           (sale_id, product_id, product_name, barcode, uom, quantity, unit_price,
            tax_percent, line_subtotal, line_total, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [nextId, it.product_id, it.product_name, it.barcode, it.uom, it.quantity,
         it.unit_price, it.tax_percent, it.line_subtotal, it.line_total, it.sort_order]
      );
    }

    await database.execute(
      `INSERT INTO sales
         (id, client_sale_id, idempotency_key, receipt_no, server_sale_id, subtotal,
          discount_amount, tax_amount, total_amount, paid_amount, change_amount,
          payment_method, card_type, notes, cashier_user_id, cashier_username,
          sync_status, error_kind, next_attempt_at, first_failed_at, last_error,
          retry_count, stock_applied, created_at_client, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [nextId, raw.client_sale_id, raw.idempotency_key, nextReceipt, raw.server_sale_id,
       raw.subtotal, raw.discount_amount, raw.tax_amount, raw.total_amount, raw.paid_amount,
       raw.change_amount, raw.payment_method, raw.card_type, raw.notes, raw.cashier_user_id,
       raw.cashier_username, raw.sync_status, raw.error_kind, raw.next_attempt_at,
       raw.first_failed_at, raw.last_error, raw.retry_count, stockApplied,
       raw.created_at_client, raw.synced_at]
    );

    if (decrementNow && stockApplied === 0) {
      await applyStockForSale(nextId);
    }
    return { saleId: nextId, receiptNo: nextReceipt };
  }

  export async function insertSale(input: NewSaleInput): Promise<{ saleId: number; receiptNo: number }> {
    const raw: RawSaleRow = {
      client_sale_id: input.client_sale_id,
      idempotency_key: input.idempotency_key,
      server_sale_id: null,
      subtotal: input.subtotal,
      discount_amount: input.discount_amount,
      tax_amount: input.tax_amount,
      total_amount: input.total_amount,
      paid_amount: input.paid_amount,
      change_amount: input.change_amount,
      payment_method: input.payment_method,
      card_type: input.card_type,
      notes: input.notes,
      cashier_user_id: input.cashier_user_id,
      cashier_username: input.cashier_username,
      sync_status: 'pending',
      error_kind: null,
      next_attempt_at: null,
      first_failed_at: null,
      last_error: null,
      retry_count: 0,
      synced_at: null,
      created_at_client: input.created_at_client,
    };
    return insertSaleRaw(raw, input.items, 0, true);
  }

  async function attachItems(sales: LocalSale[]): Promise<SaleWithItems[]> {
    const database = await getDb();
    const out: SaleWithItems[] = [];
    for (const s of sales) {
      const items = await database.select<LocalSaleItem[]>(
        'SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY sort_order ASC, id ASC',
        [s.id]
      );
      out.push({ ...s, items });
    }
    return out;
  }

  export async function getSaleWithItems(saleId: number): Promise<SaleWithItems | null> {
    const database = await getDb();
    const sales = await database.select<LocalSale[]>('SELECT * FROM sales WHERE id = $1', [saleId]);
    if (!sales[0]) return null;
    return (await attachItems(sales))[0];
  }
  ```

- [ ] **Add `reconcileLocalState`** to `db.ts` (needed by this test's crash case; full behavior re-tested in Task 3):
  ```ts
  export async function reconcileLocalState(): Promise<void> {
    const database = await getDb();
    // (a) sweep orphan sale_items whose parent sale never committed
    await database.execute('DELETE FROM sale_items WHERE sale_id NOT IN (SELECT id FROM sales)');
    // (b) apply stock exactly-once for any sale still flagged not-yet-applied
    const rows = await database.select<{ id: number }[]>(
      'SELECT id FROM sales WHERE stock_applied = 0 ORDER BY id ASC'
    );
    for (const r of rows) {
      await applyStockForSale(r.id);
    }
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-insert-sale.test.ts
  ```
  All three cases green.

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/db.ts sellary-cashier/src/lib/__tests__/db-insert-sale.test.ts
  git commit -m "feat(cashier): crash-safe insertSale with immediate base-unit stock decrement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: `reconcileLocalState` orphan-sweep + idempotency coverage

**Files:**
- Create: `sellary-cashier/src/lib/__tests__/db-reconcile.test.ts`
- (No `db.ts` change — `reconcileLocalState` already exists from Task 2; this task locks its behavior with dedicated tests.)

- [ ] **Write the failing-then-passing behavior test** `sellary-cashier/src/lib/__tests__/db-reconcile.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
  let db: typeof import('../db');

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    fake.seedProduct({ id: 1, stock_quantity: 100 });
    fake.seedProduct({ id: 2, stock_quantity: 60 });
    db = await import('../db');
  });

  describe('reconcileLocalState', () => {
    it('deletes orphan sale_items whose parent sale row is missing', async () => {
      await fake.execute(
        `INSERT INTO sale_items (sale_id, product_id, uom, quantity, unit_price, line_subtotal, line_total)
         VALUES (999, 1, 'pcs', 4, 10, 40, 40)`
      );
      await db.reconcileLocalState();
      const rows = await fake.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM sale_items');
      expect(rows[0].c).toBe(0);
      expect(fake.stockOf(1)).toBe(100); // orphan never affects stock
    });

    it('applies stock exactly once for stock_applied=0 sales and is idempotent on re-run', async () => {
      await fake.execute(
        `INSERT INTO sale_items (sale_id, product_id, uom, quantity, unit_price, line_subtotal, line_total)
         VALUES (1, 2, 'pcs', 7, 10, 70, 70)`
      );
      await fake.execute(
        `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, stock_applied, created_at_client)
         VALUES (1, 'c', 'i', 1, 'cash', 'pending', 0, '2025-01-01T00:00:00.000Z')`
      );
      await db.reconcileLocalState();
      expect(fake.stockOf(2)).toBe(53);
      const s1 = await db.getSaleWithItems(1);
      expect(s1?.stock_applied).toBe(1);
      await db.reconcileLocalState();
      expect(fake.stockOf(2)).toBe(53); // no double decrement
    });

    it('leaves already-applied sales untouched', async () => {
      await fake.execute(
        `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, stock_applied, created_at_client)
         VALUES (1, 'c', 'i', 1, 'cash', 'synced', 1, '2025-01-01T00:00:00.000Z')`
      );
      await fake.execute(
        `INSERT INTO sale_items (sale_id, product_id, uom, quantity, unit_price, line_subtotal, line_total)
         VALUES (1, 1, 'pcs', 5, 10, 50, 50)`
      );
      await db.reconcileLocalState();
      expect(fake.stockOf(1)).toBe(100); // stock_applied=1 → not re-decremented
    });
  });
  ```

- [ ] **Run it and see it PASS** (implementation already exists from Task 2 — this proves the behavior directly):
  ```
  npx vitest run src/lib/__tests__/db-reconcile.test.ts
  ```
  If any case fails, fix `reconcileLocalState`/`applyStockForSale` in `db.ts` until green (do not touch the test). Then re-run to confirm PASS.

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/__tests__/db-reconcile.test.ts
  git commit -m "test(cashier): lock reconcileLocalState orphan-sweep and idempotent decrement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Sync-worker DAOs (sendable, state transitions, counts, unsynced qty)

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts` (append sync-worker DAOs)
- Create: `sellary-cashier/src/lib/__tests__/db-sync-dao.test.ts`

- [ ] **Write the failing test** `sellary-cashier/src/lib/__tests__/db-sync-dao.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
  let db: typeof import('../db');

  function input(over: Partial<import('../db').NewSaleInput> = {}): import('../db').NewSaleInput {
    return {
      client_sale_id: over.client_sale_id ?? 'c-1',
      idempotency_key: over.idempotency_key ?? 'i-1',
      subtotal: 10, discount_amount: 0, tax_amount: 0, total_amount: 10,
      paid_amount: 10, change_amount: 0, payment_method: 'cash', card_type: null,
      notes: null, cashier_user_id: 1, cashier_username: 'k',
      created_at_client: over.created_at_client ?? '2025-01-01T08:00:00.000Z',
      items: over.items ?? [
        { product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 2,
          unit_price: 5, tax_percent: 0, line_subtotal: 10, line_total: 10, sort_order: 0 },
      ],
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    fake.seedProduct({ id: 1, stock_quantity: 100 });
    fake.seedProduct({ id: 2, stock_quantity: 100 });
    db = await import('../db');
  });

  describe('sync-worker DAOs', () => {
    it('getSendableSales returns pending oldest-first and rebuilds items', async () => {
      await db.insertSale(input({ client_sale_id: 'c-2', idempotency_key: 'i-2', created_at_client: '2025-01-01T09:00:00.000Z' }));
      await db.insertSale(input({ client_sale_id: 'c-1', idempotency_key: 'i-1', created_at_client: '2025-01-01T08:00:00.000Z' }));
      const sendable = await db.getSendableSales('2025-01-01T10:00:00.000Z');
      expect(sendable.map((s) => s.client_sale_id)).toEqual(['c-1', 'c-2']);
      expect(sendable[0].items).toHaveLength(1);
      expect(sendable[0].items[0].quantity).toBe(2);
    });

    it('getSendableSales includes due transient failures and excludes future/permanent', async () => {
      const { saleId: due } = await db.insertSale(input({ client_sale_id: 'due', idempotency_key: 'd' }));
      const { saleId: future } = await db.insertSale(input({ client_sale_id: 'fut', idempotency_key: 'f' }));
      const { saleId: perm } = await db.insertSale(input({ client_sale_id: 'perm', idempotency_key: 'p' }));
      await db.markTransientFailure([due], '2025-01-01T07:00:00.000Z', 'net');
      await db.markTransientFailure([future], '2025-01-01T23:00:00.000Z', 'net');
      await db.markPermanentFailure(perm, 'Products not found');
      const sendable = await db.getSendableSales('2025-01-01T10:00:00.000Z');
      expect(sendable.map((s) => s.client_sale_id)).toEqual(['due']);
    });

    it('getSendableSales with includePermanent also returns permanent failures (force resend)', async () => {
      const { saleId: due } = await db.insertSale(input({ client_sale_id: 'due', idempotency_key: 'd' }));
      const { saleId: perm } = await db.insertSale(input({ client_sale_id: 'perm', idempotency_key: 'p' }));
      await db.markTransientFailure([due], '2025-01-01T07:00:00.000Z', 'net');
      await db.markPermanentFailure(perm, 'Products not found');
      const forced = await db.getSendableSales('2025-01-01T10:00:00.000Z', { includePermanent: true });
      expect(forced.map((s) => s.client_sale_id).sort()).toEqual(['due', 'perm']);
    });

    it('markSaleSyncing / markSaleSynced move a sale to terminal synced', async () => {
      const { saleId } = await db.insertSale(input());
      await db.markSaleSyncing(saleId);
      let s = await db.getSaleWithItems(saleId);
      expect(s?.sync_status).toBe('syncing');
      await db.markSaleSynced(saleId, 555);
      s = await db.getSaleWithItems(saleId);
      expect(s?.sync_status).toBe('synced');
      expect(s?.server_sale_id).toBe(555);
      expect(s?.synced_at).not.toBeNull();
    });

    it('recoverSyncingSales moves syncing → failed+transient and returns the count', async () => {
      const { saleId } = await db.insertSale(input());
      await db.markSaleSyncing(saleId);
      const n = await db.recoverSyncingSales('2025-01-01T10:00:00.000Z');
      expect(n).toBe(1);
      const s = await db.getSaleWithItems(saleId);
      expect(s?.sync_status).toBe('failed');
      expect(s?.error_kind).toBe('transient');
      expect(s?.next_attempt_at).toBe('2025-01-01T10:00:00.000Z');
    });

    it('counts: unsynced excludes permanent; needs-attention counts only permanent', async () => {
      const { saleId: t } = await db.insertSale(input({ client_sale_id: 't', idempotency_key: 't' }));
      const { saleId: p } = await db.insertSale(input({ client_sale_id: 'p', idempotency_key: 'p' }));
      await db.insertSale(input({ client_sale_id: 'pending', idempotency_key: 'pe' })); // pending
      await db.markTransientFailure([t], '2025-01-01T07:00:00.000Z', 'net');
      await db.markPermanentFailure(p, 'boom');
      expect(await db.getUnsyncedCount()).toBe(2);        // pending + transient-failed
      expect(await db.getNeedsAttentionCount()).toBe(1);  // permanent only
    });

    it('acknowledgeSale drops a permanent failure from needs-attention but keeps the row', async () => {
      const { saleId: p } = await db.insertSale(input({ client_sale_id: 'p', idempotency_key: 'p' }));
      await db.markPermanentFailure(p, 'boom');
      expect(await db.getNeedsAttentionCount()).toBe(1);
      await db.acknowledgeSale(p);
      expect(await db.getNeedsAttentionCount()).toBe(0);   // acknowledged → out of the count
      const s = await db.getSaleWithItems(p);
      expect(s?.acknowledged).toBe(1);                     // row kept
      expect(s?.sync_status).toBe('failed');               // still failed, never blocks logout
    });

    it('getUnsyncedBaseQtyByProduct sums base qty over ALL non-synced sales (incl. permanent)', async () => {
      const { saleId: p } = await db.insertSale(input({
        client_sale_id: 'a', idempotency_key: 'a',
        items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 4, unit_price: 5, tax_percent: 0, line_subtotal: 20, line_total: 20, sort_order: 0 }],
      }));
      const { saleId: syncedId } = await db.insertSale(input({
        client_sale_id: 'b', idempotency_key: 'b',
        items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 3, unit_price: 5, tax_percent: 0, line_subtotal: 15, line_total: 15, sort_order: 0 }],
      }));
      await db.markPermanentFailure(p, 'boom');       // still counts toward unsynced qty
      await db.markSaleSynced(syncedId, 1);           // synced → excluded
      const map = await db.getUnsyncedBaseQtyByProduct();
      expect(map.get(1)).toBe(4);
      expect(map.get(2)).toBeUndefined();
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/lib/__tests__/db-sync-dao.test.ts
  ```
  Expected failure: `db.getSendableSales is not a function`.

- [ ] **Append the sync-worker DAOs to `db.ts`:**
  ```ts
  // Default: pending OR (failed & transient & due). With opts.includePermanent (force/manual
  // resend from History/NeedsAttention), ALSO include failed & permanent (spec/contract §4.2).
  export async function getSendableSales(
    nowIso: string,
    opts?: { includePermanent?: boolean }
  ): Promise<SaleWithItems[]> {
    const database = await getDb();
    const permanentClause = opts?.includePermanent
      ? " OR (sync_status = 'failed' AND error_kind = 'permanent')"
      : '';
    const sales = await database.select<LocalSale[]>(
      `SELECT * FROM sales
       WHERE sync_status = 'pending'
          OR (sync_status = 'failed' AND error_kind = 'transient'
              AND (next_attempt_at IS NULL OR next_attempt_at <= $1))${permanentClause}
       ORDER BY created_at_client ASC, id ASC`,
      [nowIso]
    );
    return attachItems(sales);
  }

  export async function markSaleSyncing(saleId: number): Promise<void> {
    const database = await getDb();
    await database.execute(
      "UPDATE sales SET sync_status = 'syncing', updated_at = datetime('now') WHERE id = $1",
      [saleId]
    );
  }

  export async function markSaleSynced(saleId: number, serverSaleId: number | null): Promise<void> {
    const database = await getDb();
    await database.execute(
      `UPDATE sales
       SET sync_status = 'synced', server_sale_id = $1, error_kind = NULL,
           next_attempt_at = NULL, last_error = NULL,
           synced_at = datetime('now'), updated_at = datetime('now')
       WHERE id = $2`,
      [serverSaleId, saleId]
    );
  }

  export async function markTransientFailure(saleIds: number[], nextAttemptAt: string, error: string): Promise<void> {
    if (saleIds.length === 0) return;
    const database = await getDb();
    for (const id of saleIds) {
      await database.execute(
        `UPDATE sales
         SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
             last_error = $2, retry_count = retry_count + 1,
             first_failed_at = COALESCE(first_failed_at, datetime('now')),
             updated_at = datetime('now')
         WHERE id = $3`,
        [nextAttemptAt, error, id]
      );
    }
  }

  export async function markPermanentFailure(saleId: number, error: string): Promise<void> {
    const database = await getDb();
    await database.execute(
      `UPDATE sales
       SET sync_status = 'failed', error_kind = 'permanent', next_attempt_at = NULL,
           last_error = $1, retry_count = retry_count + 1,
           first_failed_at = COALESCE(first_failed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE id = $2`,
      [error, saleId]
    );
  }

  export async function recoverSyncingSales(nowIso: string): Promise<number> {
    const database = await getDb();
    const result = await database.execute(
      `UPDATE sales
       SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
           last_error = COALESCE(last_error, 'Recovered from interrupted sync'),
           retry_count = retry_count + 1,
           first_failed_at = COALESCE(first_failed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE sync_status = 'syncing'`,
      [nowIso]
    );
    return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
  }

  // Badge + logout gate: pending + syncing + transient-failed. EXCLUDES permanent (spec §4.1, test §14.5).
  export async function getUnsyncedCount(): Promise<number> {
    const database = await getDb();
    const rows = await database.select<{ c: number }[]>(
      `SELECT COUNT(*) AS c FROM sales
       WHERE sync_status IN ('pending','syncing')
          OR (sync_status = 'failed' AND error_kind = 'transient')`
    );
    return rows[0]?.c ?? 0;
  }

  // Needs-attention = permanent failures the operator has NOT yet acknowledged (contract §4.3).
  // Acknowledged permanent rows drop from the count but are kept; they never block logout.
  export async function getNeedsAttentionCount(): Promise<number> {
    const database = await getDb();
    const rows = await database.select<{ c: number }[]>(
      "SELECT COUNT(*) AS c FROM sales WHERE sync_status = 'failed' AND error_kind = 'permanent' AND acknowledged = 0"
    );
    return rows[0]?.c ?? 0;
  }

  // Dismiss a permanent-failed sale from the needs-attention count without deleting the row.
  export async function acknowledgeSale(saleId: number): Promise<void> {
    const database = await getDb();
    await database.execute(
      "UPDATE sales SET acknowledged = 1, updated_at = datetime('now') WHERE id = $1",
      [saleId]
    );
  }

  // Stock reconcile: Σ base qty over ALL non-synced sales (pending+syncing+failed incl. permanent),
  // because server_stock does NOT include these (spec §5.2).
  export async function getUnsyncedBaseQtyByProduct(): Promise<Map<number, number>> {
    const database = await getDb();
    const rows = await database.select<{ product_id: number; qty: number }[]>(
      `SELECT si.product_id AS product_id, SUM(si.quantity) AS qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.sync_status != 'synced'
       GROUP BY si.product_id`
    );
    const map = new Map<number, number>();
    for (const r of rows) map.set(r.product_id, r.qty);
    return map;
  }
  ```
  > **Discrepancy note (intentional):** spec §2.10's inline comment says `getUnsyncedCount` = "`sync_status != 'synced'`", but the §4.1 state machine and test §14.5 require the badge/logout count to **exclude** permanent failures. The state machine governs — implemented as `pending + syncing + transient-failed`. In contrast `getUnsyncedBaseQtyByProduct` deliberately **includes** permanent (stock correctness, §5.2). Both are asserted above.

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-sync-dao.test.ts
  ```

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/db.ts sellary-cashier/src/lib/__tests__/db-sync-dao.test.ts
  git commit -m "feat(cashier): sync-worker DAOs (sendable, state transitions, counts, unsynced qty)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Reconciling `upsertProducts` (`local = server − Σ unsynced`)

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts:57-76` (replace the blind `upsertProducts` body; signature unchanged)
- Create: `sellary-cashier/src/lib/__tests__/db-catalog-reconcile.test.ts`

- [ ] **Write the failing test** `sellary-cashier/src/lib/__tests__/db-catalog-reconcile.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
  let db: typeof import('../db');

  function serverProduct(id: number, stock: number): import('../db').LocalProduct {
    return { id, barcode: null, name: `P${id}`, uom: 'pcs', category_id: null,
      sell_price: 10, tax_percent: 0, stock_quantity: stock, is_active: true,
      updated_at: '2025-02-01T00:00:00.000Z' };
  }
  function sale(clientId: string, productId: number, qty: number): import('../db').NewSaleInput {
    return {
      client_sale_id: clientId, idempotency_key: clientId,
      subtotal: qty * 10, discount_amount: 0, tax_amount: 0, total_amount: qty * 10,
      paid_amount: qty * 10, change_amount: 0, payment_method: 'cash', card_type: null,
      notes: null, cashier_user_id: 1, cashier_username: 'k', created_at_client: '2025-01-01T08:00:00.000Z',
      items: [{ product_id: productId, product_name: `P${productId}`, barcode: null, uom: 'pcs',
        quantity: qty, unit_price: 10, tax_percent: 0, line_subtotal: qty * 10, line_total: qty * 10, sort_order: 0 }],
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    fake.seedProduct({ id: 1, stock_quantity: 100 });
    db = await import('../db');
  });

  describe('upsertProducts reconciling recompute', () => {
    it('sets local = server − Σ unsynced base qty for products in the snapshot', async () => {
      await db.insertSale(sale('s1', 1, 4)); // local now 96, unsynced qty 4
      // Server snapshot reports 90 (already includes some synced history, but NOT s1).
      await db.upsertProducts([serverProduct(1, 90)]);
      expect(fake.stockOf(1)).toBe(86); // 90 − 4
    });

    it('is idempotent — pulling the same snapshot twice does not double-subtract', async () => {
      await db.insertSale(sale('s1', 1, 4));
      await db.upsertProducts([serverProduct(1, 90)]);
      await db.upsertProducts([serverProduct(1, 90)]);
      expect(fake.stockOf(1)).toBe(86);
    });

    it('does not subtract for synced sales (server already includes them)', async () => {
      const { saleId } = await db.insertSale(sale('s1', 1, 4));
      await db.markSaleSynced(saleId, 1);
      await db.upsertProducts([serverProduct(1, 90)]);
      expect(fake.stockOf(1)).toBe(90); // synced → not re-subtracted
    });

    it('converges regardless of push-before-pull vs pull-before-push', async () => {
      // pull first, then a sale, then pull again
      await db.upsertProducts([serverProduct(1, 100)]);
      await db.insertSale(sale('s1', 1, 5));
      await db.upsertProducts([serverProduct(1, 100)]); // server still 100 (sale not yet synced)
      expect(fake.stockOf(1)).toBe(95);
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/lib/__tests__/db-catalog-reconcile.test.ts
  ```
  Expected failure: the blind overwrite sets stock to the raw server value (`90` / `100`), so the first case gets `90` not `86`.

- [ ] **Replace the `upsertProducts` body in `db.ts`** (keep the `export async function upsertProducts(products: LocalProduct[]): Promise<void>` signature). Swap lines 57-76 for:
  ```ts
  export async function upsertProducts(products: LocalProduct[]): Promise<void> {
    const database = await getDb();
    // 1. Upsert authoritative server stock (resets local to server value → recompute is idempotent).
    for (const p of products) {
      await database.execute(
        `INSERT INTO products (id, barcode, name, uom, category_id, sell_price, tax_percent, stock_quantity, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
           barcode = excluded.barcode,
           name = excluded.name,
           uom = excluded.uom,
           category_id = excluded.category_id,
           sell_price = excluded.sell_price,
           tax_percent = excluded.tax_percent,
           stock_quantity = excluded.stock_quantity,
           is_active = excluded.is_active,
           updated_at = excluded.updated_at`,
        [p.id, p.barcode, p.name, p.uom, p.category_id, p.sell_price, p.tax_percent, p.stock_quantity, p.is_active ? 1 : 0, p.updated_at]
      );
    }
    // 2. Re-subtract not-yet-synced base qty so local = server − Σ unsynced (spec §5.2).
    const pulled = new Set(products.map((p) => p.id));
    const unsynced = await getUnsyncedBaseQtyByProduct();
    for (const [productId, qty] of unsynced) {
      if (!pulled.has(productId)) continue; // only reconcile products present in this snapshot
      await database.execute(
        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [qty, productId]
      );
    }
  }
  ```
  > **Callers MUST pass RAW server products (contract §4.1).** `upsertProducts` is the **SOLE** owner of the `local = server_stock − Σ unsynced` subtraction. The sync-engine's `pullCatalog` (plan 4) MUST hand the untouched `bootstrap.products` straight to `upsertProducts` and MUST NOT pre-subtract unsynced qty itself — a second subtraction would yield `local = server − 2×Σunsynced`, halving a week of offline stock on every reconnect. `getUnsyncedBaseQtyByProduct` (Task 4) counts ALL unsynced rows (`pending`+`syncing`+`failed`, incl. permanent), so this single subtraction is complete.

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-catalog-reconcile.test.ts
  ```

- [ ] **Regression: existing db-dependent tests still green.** Run the full cashier suite:
  ```
  npm test
  ```
  All files pass (existing `sync-service.test.ts` / `auth-store.test.ts` unaffected — they mock `../db`).

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/db.ts sellary-cashier/src/lib/__tests__/db-catalog-reconcile.test.ts
  git commit -m "feat(cashier): reconciling catalog upsert (local = server minus unsynced)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6: History DAOs (`getSalesHistory`, `getHistoryAggregates`, `getSaleWithItems`)

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts` (append history DAOs + `HistoryFilter`)
- Create: `sellary-cashier/src/lib/__tests__/db-history.test.ts`

- [ ] **Write the failing test** `sellary-cashier/src/lib/__tests__/db-history.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
  let db: typeof import('../db');

  function sale(over: Partial<import('../db').NewSaleInput> & { total?: number } = {}): import('../db').NewSaleInput {
    const total = over.total ?? 100;
    return {
      client_sale_id: over.client_sale_id ?? 'c-1', idempotency_key: over.idempotency_key ?? 'i-1',
      subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
      paid_amount: total, change_amount: 0,
      payment_method: over.payment_method ?? 'cash', card_type: over.card_type ?? null,
      notes: null, cashier_user_id: 1, cashier_username: 'k',
      created_at_client: over.created_at_client ?? '2025-01-01T08:30:00.000Z',
      items: over.items ?? [
        { product_id: 1, product_name: 'Milk', barcode: '111', uom: 'pcs', quantity: 1,
          unit_price: total, tax_percent: 0, line_subtotal: total, line_total: total, sort_order: 0 },
      ],
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    fake.seedProduct({ id: 1, stock_quantity: 100 });
    db = await import('../db');
  });

  describe('history DAOs', () => {
    it('getSalesHistory orders newest-first and paginates', async () => {
      await db.insertSale(sale({ client_sale_id: 'a', idempotency_key: 'a', created_at_client: '2025-01-01T08:00:00.000Z' }));
      await db.insertSale(sale({ client_sale_id: 'b', idempotency_key: 'b', created_at_client: '2025-01-01T09:00:00.000Z' }));
      await db.insertSale(sale({ client_sale_id: 'c', idempotency_key: 'c', created_at_client: '2025-01-01T10:00:00.000Z' }));
      const page1 = await db.getSalesHistory({ limit: 2, offset: 0 });
      expect(page1.map((s) => s.client_sale_id)).toEqual(['c', 'b']);
      const page2 = await db.getSalesHistory({ limit: 2, offset: 2 });
      expect(page2.map((s) => s.client_sale_id)).toEqual(['a']);
    });

    it('getSalesHistory filters by payment method and sync tab', async () => {
      await db.insertSale(sale({ client_sale_id: 'cash1', idempotency_key: 'x1', payment_method: 'cash' }));
      const { saleId } = await db.insertSale(sale({ client_sale_id: 'card1', idempotency_key: 'x2', payment_method: 'card', card_type: 'alif' }));
      await db.markSaleSynced(saleId, 1);
      expect((await db.getSalesHistory({ paymentMethod: 'card' })).map((s) => s.client_sale_id)).toEqual(['card1']);
      expect((await db.getSalesHistory({ syncFilter: 'synced' })).map((s) => s.client_sale_id)).toEqual(['card1']);
      expect((await db.getSalesHistory({ syncFilter: 'unsynced' })).map((s) => s.client_sale_id)).toEqual(['cash1']);
    });

    it('getHistoryAggregates computes turnover/count/unsynced over the whole filter, not the page', async () => {
      for (let i = 0; i < 3; i++) {
        await db.insertSale(sale({ client_sale_id: `p${i}`, idempotency_key: `p${i}`, total: 50, created_at_client: '2025-01-01T08:15:00.000Z' }));
      }
      const { saleId } = await db.insertSale(sale({ client_sale_id: 'done', idempotency_key: 'done', total: 200, created_at_client: '2025-01-01T14:00:00.000Z' }));
      await db.markSaleSynced(saleId, 9);
      const agg = await db.getHistoryAggregates({ limit: 1, offset: 0 });
      expect(agg.turnover).toBe(350);   // 3×50 + 200 across the full filter
      expect(agg.count).toBe(4);
      expect(agg.unsynced).toBe(3);      // the 3 pending
      expect(agg.hourly[8]).toBe(150);   // three 50-sales at 08:15
      expect(agg.hourly[14]).toBe(200);
    });

    it('getSaleWithItems returns structured snapshot rows (drift-proof after product delete)', async () => {
      const { saleId } = await db.insertSale(sale({ client_sale_id: 'z', idempotency_key: 'z' }));
      await fake.execute('DELETE FROM products WHERE id = 1'); // product removed after sale
      const detail = await db.getSaleWithItems(saleId);
      expect(detail?.items[0].product_name).toBe('Milk'); // snapshot survives
      expect(detail?.items[0].barcode).toBe('111');
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/lib/__tests__/db-history.test.ts
  ```
  Expected failure: `db.getSalesHistory is not a function` (and `getHistoryAggregates`).

- [ ] **Append the history DAOs + `HistoryFilter` + shared WHERE builder to `db.ts`:**
  ```ts
  export interface HistoryFilter {
    search?: string;
    paymentMethod?: string;                                     // falsy OR 'all' ⇒ NO filter
    syncFilter?: 'all' | 'synced' | 'unsynced' | 'attention';
    dateFrom?: string;                                          // ISO inclusive (NOT startDate)
    dateTo?: string;                                            // ISO inclusive (NOT endDate)
    limit?: number;
    offset?: number;
  }

  // Builds the shared WHERE clause + ordered $N params for both list and aggregates.
  function buildHistoryWhere(opts: HistoryFilter): { whereSql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.search) {
      const q = `%${opts.search}%`;
      params.push(q); const p1 = params.length;
      params.push(q); const p2 = params.length;
      where.push(`(s.client_sale_id LIKE $${p1} OR CAST(s.receipt_no AS TEXT) LIKE $${p2})`);
    }
    if (opts.paymentMethod && opts.paymentMethod !== 'all') {   // falsy OR 'all' ⇒ no payment filter
      params.push(opts.paymentMethod);
      where.push(`s.payment_method = $${params.length}`);
    }
    if (opts.dateFrom) {
      params.push(opts.dateFrom);
      where.push(`s.created_at_client >= $${params.length}`);
    }
    if (opts.dateTo) {
      params.push(opts.dateTo);
      where.push(`s.created_at_client <= $${params.length}`);
    }
    if (opts.syncFilter && opts.syncFilter !== 'all') {
      if (opts.syncFilter === 'synced') where.push(`s.sync_status = 'synced'`);
      else if (opts.syncFilter === 'unsynced')
        where.push(`(s.sync_status IN ('pending','syncing') OR (s.sync_status = 'failed' AND s.error_kind = 'transient'))`);
      else if (opts.syncFilter === 'attention')
        where.push(`(s.sync_status = 'failed' AND s.error_kind = 'permanent')`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return { whereSql, params };
  }

  export async function getSalesHistory(opts: HistoryFilter = {}): Promise<LocalSale[]> {
    const database = await getDb();
    const { whereSql, params } = buildHistoryWhere(opts);
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    params.push(limit); const lp = params.length;
    params.push(offset); const op = params.length;
    return database.select<LocalSale[]>(
      `SELECT s.* FROM sales s ${whereSql}
       ORDER BY s.created_at_client DESC, s.id DESC
       LIMIT $${lp} OFFSET $${op}`,
      params
    );
  }

  export async function getHistoryAggregates(
    opts: HistoryFilter = {}
  ): Promise<{ turnover: number; count: number; unsynced: number; hourly: number[] }> {
    const database = await getDb();
    const { whereSql, params } = buildHistoryWhere(opts);
    const totals = await database.select<{ turnover: number; count: number; unsynced: number }[]>(
      `SELECT COALESCE(SUM(s.total_amount), 0) AS turnover,
              COUNT(*) AS count,
              COALESCE(SUM(CASE
                WHEN s.sync_status IN ('pending','syncing')
                     OR (s.sync_status = 'failed' AND s.error_kind = 'transient')
                THEN 1 ELSE 0 END), 0) AS unsynced
       FROM sales s ${whereSql}`,
      params
    );
    const hourlyRows = await database.select<{ h: number; turnover: number }[]>(
      `SELECT CAST(strftime('%H', s.created_at_client) AS INTEGER) AS h,
              COALESCE(SUM(s.total_amount), 0) AS turnover
       FROM sales s ${whereSql}
       GROUP BY h`,
      params
    );
    const hourly = new Array(24).fill(0);
    for (const r of hourlyRows) {
      if (r.h >= 0 && r.h < 24) hourly[r.h] = r.turnover;
    }
    return {
      turnover: totals[0]?.turnover ?? 0,
      count: totals[0]?.count ?? 0,
      unsynced: totals[0]?.unsynced ?? 0,
      hourly,
    };
  }
  ```
  > `getSaleWithItems` already exists (Task 2); the history test reuses it. `hourly` is a 24-bucket array of per-hour turnover; the UI slices 08:00–22:00 (§8.1).

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-history.test.ts
  ```

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/db.ts sellary-cashier/src/lib/__tests__/db-history.test.ts
  git commit -m "feat(cashier): sales-history DAOs with full-filter aggregates over local model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 7: Device-auth single-row DAO

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts` (append device-auth DAO + `DeviceAuth`/`DeviceIdentityInput`)
- Create: `sellary-cashier/src/lib/__tests__/db-device-auth.test.ts`

- [ ] **Write the failing test** `sellary-cashier/src/lib/__tests__/db-device-auth.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
  let db: typeof import('../db');

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    db = await import('../db');
  });

  describe('device-auth DAO', () => {
    it('getDeviceAuth returns null before provisioning', async () => {
      expect(await db.getDeviceAuth()).toBeNull();
    });

    it('ensureDeviceAuth creates the single id=1 row once and is idempotent', async () => {
      const a = await db.ensureDeviceAuth('dev-uuid-1');
      expect(a.id).toBe(1);
      expect(a.device_id).toBe('dev-uuid-1');
      const b = await db.ensureDeviceAuth('dev-uuid-2'); // does NOT overwrite existing device_id
      expect(b.device_id).toBe('dev-uuid-1');
      const rows = await fake.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM device_auth');
      expect(rows[0].c).toBe(1);
    });

    it('setPinHash and bindDeviceIdentity persist onto the single row', async () => {
      await db.ensureDeviceAuth('dev-uuid-1');
      await db.setPinHash('$argon2id$v=19$m=...$hash');
      await db.bindDeviceIdentity({
        user_id: 7, username: 'kassa', company_id: 3, company_name: 'Shop',
        user_role: 'cashier', device_token_expires_at: '2026-12-31T00:00:00.000Z',
        last_online_auth_at: '2026-07-10T00:00:00.000Z',
      });
      const a = await db.getDeviceAuth();
      expect(a?.pin_hash).toBe('$argon2id$v=19$m=...$hash');
      expect(a?.pin_set_at).not.toBeNull();
      expect(a?.user_id).toBe(7);
      expect(a?.company_name).toBe('Shop');
      expect(a?.device_token_expires_at).toBe('2026-12-31T00:00:00.000Z');
    });

    it('recordPinFailure increments and lockout; resetPinFailures clears', async () => {
      await db.ensureDeviceAuth('dev-uuid-1');
      await db.recordPinFailure();
      await db.recordPinFailure('2026-07-10T00:05:00.000Z');
      let a = await db.getDeviceAuth();
      expect(a?.failed_pin_attempts).toBe(2);
      expect(a?.locked_until).toBe('2026-07-10T00:05:00.000Z');
      await db.resetPinFailures();
      a = await db.getDeviceAuth();
      expect(a?.failed_pin_attempts).toBe(0);
      expect(a?.locked_until).toBeNull();
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/lib/__tests__/db-device-auth.test.ts
  ```
  Expected failure: `db.getDeviceAuth is not a function`.

- [ ] **Append the device-auth DAO to `db.ts`:**
  ```ts
  export interface DeviceAuth {
    id: number;
    device_id: string;
    device_token_expires_at: string | null;
    pin_hash: string | null;
    pin_set_at: string | null;
    failed_pin_attempts: number;
    locked_until: string | null;
    user_id: number | null;
    username: string | null;
    company_id: number | null;
    company_name: string | null;
    user_role: string | null;
    last_online_auth_at: string | null;
    created_at: string;
    updated_at: string;
  }

  export interface DeviceIdentityInput {
    user_id: number;
    username: string;
    company_id: number;
    company_name: string;
    user_role: string;
    device_token_expires_at: string | null;
    last_online_auth_at: string;
  }

  export async function getDeviceAuth(): Promise<DeviceAuth | null> {
    const database = await getDb();
    const rows = await database.select<DeviceAuth[]>('SELECT * FROM device_auth WHERE id = 1');
    return rows[0] || null;
  }

  export async function ensureDeviceAuth(deviceId: string): Promise<DeviceAuth> {
    const database = await getDb();
    const existing = await getDeviceAuth();
    if (existing) return existing;
    await database.execute(
      'INSERT INTO device_auth (id, device_id) VALUES (1, $1)',
      [deviceId]
    );
    const created = await getDeviceAuth();
    if (!created) throw new Error('Failed to create device_auth row');
    return created;
  }

  export async function setPinHash(hash: string): Promise<void> {
    const database = await getDb();
    await database.execute(
      `UPDATE device_auth
       SET pin_hash = $1, pin_set_at = datetime('now'),
           failed_pin_attempts = 0, locked_until = NULL,
           updated_at = datetime('now')
       WHERE id = 1`,
      [hash]
    );
  }

  export async function bindDeviceIdentity(i: DeviceIdentityInput): Promise<void> {
    const database = await getDb();
    await database.execute(
      `UPDATE device_auth
       SET user_id = $1, username = $2, company_id = $3, company_name = $4,
           user_role = $5, device_token_expires_at = $6, last_online_auth_at = $7,
           updated_at = datetime('now')
       WHERE id = 1`,
      [i.user_id, i.username, i.company_id, i.company_name, i.user_role,
       i.device_token_expires_at, i.last_online_auth_at]
    );
  }

  export async function recordPinFailure(lockUntil?: string | null): Promise<void> {
    const database = await getDb();
    await database.execute(
      `UPDATE device_auth
       SET failed_pin_attempts = failed_pin_attempts + 1,
           locked_until = $1,
           updated_at = datetime('now')
       WHERE id = 1`,
      [lockUntil ?? null]
    );
  }

  export async function resetPinFailures(): Promise<void> {
    const database = await getDb();
    await database.execute(
      `UPDATE device_auth
       SET failed_pin_attempts = 0, locked_until = NULL, updated_at = datetime('now')
       WHERE id = 1`
    );
  }
  ```
  > Note: `recordPinFailure` sets `locked_until` to the passed value (or `NULL` when omitted). The lockout curve (5 fails → exponential backoff) is computed by the caller (offline-auth plan) which passes the ISO `lockUntil`; the DAO only persists.

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-device-auth.test.ts
  ```

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/db.ts sellary-cashier/src/lib/__tests__/db-device-auth.test.ts
  git commit -m "feat(cashier): single-row device_auth DAO (identity, PIN hash, lockout)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 8: One-time `outbox_sales → sales` backfill (corrected `stock_applied`)

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts` (append `migrateOutboxToSalesOnce`; rename legacy `recoverSyncingSales` → `recoverSyncingOutboxSales`)
- Modify: `sellary-cashier/src/lib/sync-service.ts` (update the one legacy call)
- Modify: `sellary-cashier/src/lib/__tests__/sync-service.test.ts` (rename the mocked key)
- Create: `sellary-cashier/src/lib/__tests__/db-backfill.test.ts`

- [ ] **Resolve the name clash first.** In `db.ts`, rename the existing legacy function (lines ~174-185) `export async function recoverSyncingSales(error = 'Recovered from interrupted sync')` to `export async function recoverSyncingOutboxSales(error = 'Recovered from interrupted sync')` (body unchanged — it operates on `outbox_sales`). The new `sales`-table `recoverSyncingSales(nowIso)` from Task 4 keeps the spec §2.10 name.

- [ ] **Update the single caller** in `sellary-cashier/src/lib/sync-service.ts`: find the `recoverSyncingSales(` call and the import, rename both to `recoverSyncingOutboxSales`. (Use Grep to confirm exactly one import + one call site.)

- [ ] **Update the mock key** in `sellary-cashier/src/lib/__tests__/sync-service.test.ts`: rename the hoisted mock `mockRecoverSyncingSales` binding target key in the `vi.mock('../db', ...)` object from `recoverSyncingSales:` to `recoverSyncingOutboxSales:` (keep the variable name `mockRecoverSyncingSales`). This keeps the existing sync-service suite green.

- [ ] **Run the existing suite to confirm the rename is clean:**
  ```
  npx vitest run src/lib/__tests__/sync-service.test.ts
  ```
  Still green (mechanical rename only).

- [ ] **Write the failing backfill test** `sellary-cashier/src/lib/__tests__/db-backfill.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { createTestDb, FakeDatabase } from './helpers/fakeDb';

  let fake: FakeDatabase;
  vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
  let db: typeof import('../db');

  function legacyPayload(items: { product_id: number; quantity: number; sell_price: number }[]) {
    return JSON.stringify({
      client_sale_id: 'x', idempotency_key: 'x', created_at_client: '2025-01-01T08:00:00.000Z',
      payment_method: 'CASH', card_type: null, discount_amount: 0, paid_amount: 0, change_amount: 0, items,
    });
  }
  async function seedOutbox(row: { client_sale_id: string; status: string; request_json: string; retry_count?: number }) {
    await fake.execute(
      `INSERT INTO outbox_sales (client_sale_id, idempotency_key, status, request_json, created_at_client, retry_count)
       VALUES ($1, $2, $3, $4, '2025-01-01T08:00:00.000Z', $5)`,
      [row.client_sale_id, `idem-${row.client_sale_id}`, row.status, row.request_json, row.retry_count ?? 0]
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    fake = createTestDb();
    fake.seedProduct({ id: 1, stock_quantity: 100 });
    fake.seedProduct({ id: 2, stock_quantity: 100 });
    db = await import('../db');
  });

  describe('migrateOutboxToSalesOnce', () => {
    it('legacy pending/failed → stock_applied=0 then decremented by reconcile; legacy synced → stock_applied=1 (no double decrement)', async () => {
      await seedOutbox({ client_sale_id: 'pend', status: 'pending', request_json: legacyPayload([{ product_id: 1, quantity: 4, sell_price: 10 }]) });
      await seedOutbox({ client_sale_id: 'fail', status: 'failed', request_json: legacyPayload([{ product_id: 1, quantity: 3, sell_price: 10 }]) });
      await seedOutbox({ client_sale_id: 'sync', status: 'synced', request_json: legacyPayload([{ product_id: 2, quantity: 5, sell_price: 10 }]) });

      await db.migrateOutboxToSalesOnce();

      // pending(4) + failed(3) never applied historically → now decremented once each
      expect(fake.stockOf(1)).toBe(93); // 100 - 4 - 3
      // synced(5) already applied historically → NOT decremented again
      expect(fake.stockOf(2)).toBe(100);

      const pend = await db.getSaleWithItems((await db.getSalesHistory({ syncFilter: 'unsynced' })).find((s) => s.client_sale_id === 'pend')!.id);
      expect(pend?.sync_status).toBe('pending');
      expect(pend?.stock_applied).toBe(1); // applied by the reconcile the backfill runs
      const fail = (await db.getSalesHistory({ syncFilter: 'unsynced' })).find((s) => s.client_sale_id === 'fail');
      expect(fail?.error_kind).toBe('transient');
      const synced = (await db.getSalesHistory({ syncFilter: 'synced' })).find((s) => s.client_sale_id === 'sync');
      expect(synced?.stock_applied).toBe(1);
    });

    it('migrates syncing → failed+transient and lowercases payment method', async () => {
      await seedOutbox({ client_sale_id: 'insync', status: 'syncing', request_json: legacyPayload([{ product_id: 1, quantity: 2, sell_price: 10 }]) });
      await db.migrateOutboxToSalesOnce();
      const s = (await db.getSalesHistory({ syncFilter: 'unsynced' })).find((x) => x.client_sale_id === 'insync');
      expect(s?.sync_status).toBe('failed');
      expect(s?.error_kind).toBe('transient');
      expect(s?.payment_method).toBe('cash');
    });

    it('skips malformed request_json per-row (logs a sync_event) without aborting', async () => {
      await seedOutbox({ client_sale_id: 'bad', status: 'pending', request_json: '{not json' });
      await seedOutbox({ client_sale_id: 'good', status: 'pending', request_json: legacyPayload([{ product_id: 1, quantity: 1, sell_price: 10 }]) });
      await db.migrateOutboxToSalesOnce();
      const good = await db.getSalesHistory({ syncFilter: 'unsynced' });
      expect(good.map((s) => s.client_sale_id)).toContain('good');
      expect(good.map((s) => s.client_sale_id)).not.toContain('bad');
      const events = await fake.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM sync_events WHERE status = 'error'");
      expect(events[0].c).toBeGreaterThanOrEqual(1);
    });

    it('is a no-op on re-run (outbox_migrated_v2 flag)', async () => {
      await seedOutbox({ client_sale_id: 'one', status: 'pending', request_json: legacyPayload([{ product_id: 1, quantity: 6, sell_price: 10 }]) });
      await db.migrateOutboxToSalesOnce();
      expect(fake.stockOf(1)).toBe(94);
      await db.migrateOutboxToSalesOnce(); // guarded — must not re-copy or re-decrement
      expect(fake.stockOf(1)).toBe(94);
      const rows = await fake.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM sales');
      expect(rows[0].c).toBe(1);
      expect(await db.getMeta('outbox_migrated_v2')).toBe('1');
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/lib/__tests__/db-backfill.test.ts
  ```
  Expected failure: `db.migrateOutboxToSalesOnce is not a function`.

- [ ] **Append `migrateOutboxToSalesOnce` to `db.ts`:**
  ```ts
  interface LegacyOutboxRow {
    client_sale_id: string;
    idempotency_key: string;
    status: string;
    request_json: string;
    response_json: string | null;
    last_error: string | null;
    created_at_client: string;
    synced_at: string | null;
    retry_count: number;
  }

  interface LegacyPayload {
    payment_method?: string;
    card_type?: string | null;
    discount_amount?: number;
    paid_amount?: number;
    change_amount?: number;
    notes?: string | null;
    items?: Array<{ product_id: number; quantity: number; sell_price: number }>;
  }

  // One-time idempotent backfill of legacy outbox_sales into the structured sales/sale_items
  // model, then a reconcile to recover offline decrements the old code lost (spec §2.8).
  // Guarded by meta.outbox_migrated_v2. outbox_sales is left fully intact.
  export async function migrateOutboxToSalesOnce(): Promise<void> {
    const database = await getDb();
    if ((await getMeta('outbox_migrated_v2')) === '1') return;

    const legacy = await database.select<LegacyOutboxRow[]>(
      'SELECT * FROM outbox_sales ORDER BY id ASC'
    );

    for (const row of legacy) {
      try {
        const payload = JSON.parse(row.request_json) as LegacyPayload;

        // Map legacy status → new (syncing → failed+transient).
        let syncStatus: SyncStatus = 'pending';
        let errorKind: ErrorKind | null = null;
        let stockApplied = 0;
        if (row.status === 'synced') { syncStatus = 'synced'; stockApplied = 1; }
        else if (row.status === 'failed') { syncStatus = 'failed'; errorKind = 'transient'; }
        else if (row.status === 'syncing') { syncStatus = 'failed'; errorKind = 'transient'; }
        else { syncStatus = 'pending'; }

        const legacyItems = payload.items ?? [];
        const items: NewSaleItemInput[] = legacyItems.map((it, idx) => ({
          product_id: it.product_id,
          product_name: '',                 // legacy payload has no snapshot name
          barcode: null,
          uom: 'pcs',
          quantity: it.quantity,            // BASE units (factor 1 in Phase 1)
          unit_price: it.sell_price,
          tax_percent: 0,
          line_subtotal: it.quantity * it.sell_price,
          line_total: it.quantity * it.sell_price,
          sort_order: idx,
        }));

        const subtotal = items.reduce((sum, it) => sum + it.line_subtotal, 0);
        const discount = payload.discount_amount ?? 0;
        const total = subtotal - discount;

        // best-effort server_sale_id for already-synced legacy rows
        let serverSaleId: number | null = null;
        if (row.response_json) {
          try {
            const resp = JSON.parse(row.response_json) as { sale_id?: number | null };
            serverSaleId = resp.sale_id ?? null;
          } catch { serverSaleId = null; }
        }

        const raw: RawSaleRow = {
          client_sale_id: row.client_sale_id,
          idempotency_key: row.idempotency_key,
          server_sale_id: serverSaleId,
          subtotal,
          discount_amount: discount,
          tax_amount: 0,
          total_amount: total,
          paid_amount: payload.paid_amount ?? 0,
          change_amount: payload.change_amount ?? 0,
          payment_method: (payload.payment_method ?? 'cash').toLowerCase(),
          card_type: payload.card_type ? payload.card_type.toLowerCase() : null,
          notes: payload.notes ?? null,
          cashier_user_id: null,
          cashier_username: null,
          sync_status: syncStatus,
          error_kind: errorKind,
          next_attempt_at: null,
          first_failed_at: null,
          last_error: row.last_error,
          retry_count: row.retry_count,
          synced_at: row.synced_at,
          created_at_client: row.created_at_client,
        };

        // decrementNow=false: reconcile below decrements every stock_applied=0 row exactly once.
        await insertSaleRaw(raw, items, stockApplied, false);
      } catch (err) {
        await addSyncEvent(
          'backfill',
          'error',
          `Skipped malformed outbox row ${row.client_sale_id}: ${String(err)}`
        ).catch(() => undefined);
      }
    }

    // Recover the offline decrements the old sync-on-success code never applied (spec §2.8).
    await reconcileLocalState();
    await setMeta('outbox_migrated_v2', '1');
  }
  ```
  > Because backfill calls `insertSaleRaw` with `decrementNow=false`, legacy `synced` rows land with `stock_applied=1` (reconcile skips them → no double decrement) while legacy `pending`/`failed`/`syncing` land with `stock_applied=0` and are decremented exactly once by the trailing `reconcileLocalState()`. Re-run returns early on the `outbox_migrated_v2` flag.

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/lib/__tests__/db-backfill.test.ts
  ```

- [ ] **Run the full cashier suite** to confirm everything is green together:
  ```
  npm test
  ```

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/lib/db.ts sellary-cashier/src/lib/sync-service.ts \
          sellary-cashier/src/lib/__tests__/sync-service.test.ts \
          sellary-cashier/src/lib/__tests__/db-backfill.test.ts
  git commit -m "feat(cashier): idempotent outbox->sales backfill with corrected stock_applied

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final verification (whole plan)

- [ ] From `sellary-cashier/`: `npm test` — all suites green (migration, insert-sale, reconcile, sync-dao, catalog-reconcile, history, device-auth, backfill, plus untouched sync-service + auth-store).
- [ ] Manual Rust gate (reviewer): `npm run tauri:dev` boots and applies migration `2` cleanly (requires Rust toolchain; not automatable in vitest CI). Confirms `argon2`/stronghold unaffected and `include_str!` resolves.
- [ ] Confirm no source file outside the declared scope was edited (`git status` shows only `db.ts`, the two migration files, `lib.rs`, `sync-service.ts`, the two test-touched files, `package.json`/lock, and the new test files).
