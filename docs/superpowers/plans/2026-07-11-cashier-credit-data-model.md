# Cashier Offline Credit — Local Data Model Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Add the local SQLite schema and `db.ts` DAO surface that make **credit sales (В долг)**, **offline customers**, and **offline debt payments** work fully offline on the Tauri cashier — mirroring the proven Phase-1 sales/outbox/sync pattern (local-first + outbox + client-ID mapping + read-time reconciliation).

**Architecture:** New migration `003_offline_credit.sql` (additive DDL only: `CREATE TABLE customers`, `CREATE TABLE customer_payments`, `ALTER TABLE sales ADD COLUMN`) registered as `Migration { version: 3 }`. All new persistence + query logic lives as additive exported functions in the existing `src/lib/db.ts`; nothing in Phase-1 is renamed or removed. Debt balance is **never stored locally** — it is derived on read as `customers.balance (server value at last pull) + Σ unsynced credit remaining − Σ unsynced payments`, exactly mirroring the Phase-1 stock rule `local = server − Σ unsynced`.

**Tech Stack:** Tauri 2 SQLite via `@tauri-apps/plugin-sql`; TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`); vitest on Node 24 with the `node:sqlite` `createTestDb()` harness (NOT better-sqlite3).

**Depends on:** none at runtime. **Type-only** it imports `SyncCustomerResult` + `SyncPaymentResult` from `./api` (per contract C-7, api.ts is their sole definition site, owned by the **credit-sync** plan) — `applyCustomerIdMap`/`applyPaymentResults` consume those types without redefining them. Its own exported types (`NewCustomerInput`, `LocalCustomer`, `CustomerWithBalance`, `NewPaymentInput`, `LocalCustomerPayment`, `LocalLedgerEntry`, `ServerCustomerItem`, `CustomerFilter`) and DAO signatures are consumed by the plans **credit-sync**, **credit-pos**, and **customers-ui**.

> **Contract note (C-7 forward reference):** because api.ts's `SyncCustomerResult`/`SyncPaymentResult` are added by credit-sync (which merges *after* data-model), executing data-model in isolation requires those two `export interface`s to already exist in `src/lib/api.ts`. Land them (type-only, no runtime) as the first step of Task 7/8, or stub them in api.ts, so `npx tsc --noEmit` passes on the data-model branch. See Task 7 Step 7.3.

---

## Authoritative spec

`docs/superpowers/specs/2026-07-11-cashier-offline-credit-design.md` — sections **2** (local schema), **5.4** (DAO list), **8** (cashier testing). Use the EXACT table/column/function names it defines so all five plans compose.

---

## File Structure

**Create**
- `sellary-cashier/src-tauri/migrations/003_offline_credit.sql` — additive DDL: `customers`, `customer_payments`, two `sales` columns.
- `sellary-cashier/src/lib/__tests__/db-credit-migration.test.ts` — migration-003 schema assertions.
- `sellary-cashier/src/lib/__tests__/db-credit-sale.test.ts` — credit-sale insert via extended `insertSale`.
- `sellary-cashier/src/lib/__tests__/db-customers-dao.test.ts` — `insertCustomer` / `getCustomerByClientId` / `getCustomers`.
- `sellary-cashier/src/lib/__tests__/db-customer-payments-dao.test.ts` — `insertCustomerPayment` / `getCustomerLedgerLocal`.
- `sellary-cashier/src/lib/__tests__/db-customer-balance.test.ts` — local-balance derivation.
- `sellary-cashier/src/lib/__tests__/db-customer-reconcile.test.ts` — `upsertServerCustomers` / `reconcileCustomerBalances` idempotency.
- `sellary-cashier/src/lib/__tests__/db-customer-sync-dao.test.ts` — customer sync-worker DAOs + `applyCustomerIdMap`.
- `sellary-cashier/src/lib/__tests__/db-payment-sync-dao.test.ts` — payment sync-worker DAOs + `applyPaymentResults`.

**Modify**
- `sellary-cashier/src-tauri/src/lib.rs` — register `Migration { version: 3, ... }` after v2.
- `sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts` — `createTestDb()` also execs `003_offline_credit.sql`.
- `sellary-cashier/src/lib/db.ts` — new types + DAOs; a **type-only** `import type { SyncCustomerResult, SyncPaymentResult } from './api';` (contract C-7); extend `NewSaleInput`/`LocalSale`/`SaleWithItems` (inherits via `extends LocalSale`)/`RawSaleRow`/`insertSale`/`insertSaleRaw`/`getSaleWithItems` (`SELECT *`)/`migrateOutboxToSalesOnce` with the two new sale columns (`customer_client_id` + `initial_payment_method`, contract C-9).

---

## Conventions (apply to every task)

- Run all commands **from `sellary-cashier/`**.
- Test command: `npx vitest run <path>`. Typecheck gate: `npx tsc --noEmit` (must exit 0).
- Every test file mocks the SQL plugin the same way the existing `db-sync-dao.test.ts` does:
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
  ```
- `noUnusedLocals`/`noUnusedParameters` are on: type every callback param you use and never leave an unused import.
- Commit after each task with a conventional message; end the message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## Task 1: Migration 003 — schema + registration + test harness

**Files:**
- `sellary-cashier/src-tauri/migrations/003_offline_credit.sql` (create)
- `sellary-cashier/src-tauri/src/lib.rs` (modify)
- `sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-credit-migration.test.ts` (create)

### Step 1.1 — Write the failing schema test

Create `sellary-cashier/src/lib/__tests__/db-credit-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;

beforeEach(() => {
  fake = createTestDb();
});

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

describe('migration 003 — offline credit schema', () => {
  it('creates the customers table with the spec columns', async () => {
    const cols = await fake.select<ColumnInfo[]>('PRAGMA table_info(customers)');
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of [
      'client_customer_id', 'server_id', 'name', 'phone', 'email', 'address',
      'description', 'balance', 'is_active', 'sync_status', 'error_kind',
      'next_attempt_at', 'first_failed_at', 'last_error', 'retry_count',
      'created_at_client', 'synced_at', 'updated_at',
    ]) {
      expect(byName.has(name), `missing customers.${name}`).toBe(true);
    }
    expect(byName.get('client_customer_id')?.pk).toBe(1);
  });

  it('creates the customer_payments outbox table with the spec columns', async () => {
    const cols = await fake.select<ColumnInfo[]>('PRAGMA table_info(customer_payments)');
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of [
      'client_payment_id', 'idempotency_key', 'customer_client_id', 'amount',
      'payment_method', 'description', 'applied_amount', 'server_customer_id',
      'sync_status', 'error_kind', 'next_attempt_at', 'first_failed_at',
      'last_error', 'retry_count', 'created_at_client', 'synced_at',
    ]) {
      expect(byName.has(name), `missing customer_payments.${name}`).toBe(true);
    }
    expect(byName.get('client_payment_id')?.pk).toBe(1);
  });

  it('adds customer_client_id + initial_payment_method to sales', async () => {
    const cols = await fake.select<ColumnInfo[]>('PRAGMA table_info(sales)');
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('customer_client_id')).toBe(true);
    expect(names.has('initial_payment_method')).toBe(true);
  });
});
```

### Step 1.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-credit-migration.test.ts
```
Expected: all three tests fail. `createTestDb()` currently execs only `001`/`002`, so `PRAGMA table_info(customers)` and `PRAGMA table_info(customer_payments)` return empty arrays (`byName.has(...)` → false) and `sales` lacks the two new columns.

### Step 1.3 — Create the migration file

Create `sellary-cashier/src-tauri/migrations/003_offline_credit.sql`:

```sql
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
```

### Step 1.4 — Register migration v3 in `lib.rs`

In `sellary-cashier/src-tauri/src/lib.rs`, add a third `Migration` entry to the `vec![...]` immediately after the version-2 block:

```rust
                        Migration {
                            version: 2,
                            description: "local-first sales, history, device auth",
                            sql: include_str!("../migrations/002_local_first.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 3,
                            description: "offline credit: customers, customer_payments, sales credit columns",
                            sql: include_str!("../migrations/003_offline_credit.sql"),
                            kind: MigrationKind::Up,
                        },
```

### Step 1.5 — Make the test harness load 003

In `sellary-cashier/src/lib/__tests__/helpers/fakeDb.ts`, extend `createTestDb()` to read and exec the new migration after `002`:

```ts
export function createTestDb(): FakeDatabase {
  const raw = new DatabaseSync(':memory:');
  const sql001 = fs.readFileSync(path.join(migrationsDir, '001_init.sql'), 'utf8');
  const sql002 = fs.readFileSync(path.join(migrationsDir, '002_local_first.sql'), 'utf8');
  const sql003 = fs.readFileSync(path.join(migrationsDir, '003_offline_credit.sql'), 'utf8');
  raw.exec(sql001);
  raw.exec(sql002);
  raw.exec(sql003);
  return new FakeDatabase(raw);
}
```

### Step 1.6 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-credit-migration.test.ts
npx tsc --noEmit
```
Expected: 3 passed; `tsc` exits 0.

### Step 1.7 — Commit

```
feat(cashier): add migration 003 offline credit schema (customers, payments, sales columns)
```

---

## Task 2: Extend `insertSale` for credit (customer_client_id + initial_payment_method)

Credit sales are ordinary `sales` rows carrying a `customer_client_id` and (optionally) an `initial_payment_method`. This task widens `NewSaleInput`, `LocalSale`, the internal `RawSaleRow`, the `insertSaleRaw` INSERT, `insertSale`, and the legacy backfill so the two new columns round-trip. Non-credit inserts stay byte-for-byte identical (both fields default to `null`).

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-credit-sale.test.ts` (create)

### Step 2.1 — Write the failing credit-sale test

Create `sellary-cashier/src/lib/__tests__/db-credit-sale.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function base(over: Partial<import('../db').NewSaleInput> = {}): import('../db').NewSaleInput {
  return {
    client_sale_id: over.client_sale_id ?? 'c-1',
    idempotency_key: over.idempotency_key ?? 'i-1',
    subtotal: 100, discount_amount: 0, tax_amount: 0, total_amount: 100,
    paid_amount: over.paid_amount ?? 0, change_amount: 0,
    payment_method: over.payment_method ?? 'cash', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    customer_client_id: over.customer_client_id,
    initial_payment_method: over.initial_payment_method,
    created_at_client: over.created_at_client ?? '2025-01-01T08:00:00.000Z',
    items: over.items ?? [
      { product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 2,
        unit_price: 50, tax_percent: 0, line_subtotal: 100, line_total: 100, sort_order: 0 },
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  db = await import('../db');
});

describe('insertSale — credit fields', () => {
  it('persists customer_client_id + initial_payment_method + payment_method=credit', async () => {
    const { saleId } = await db.insertSale(
      base({ payment_method: 'credit', customer_client_id: 'cust-1',
             paid_amount: 30, initial_payment_method: 'cash' }),
    );
    const sale = await db.getSaleWithItems(saleId);
    expect(sale?.payment_method).toBe('credit');
    expect(sale?.customer_client_id).toBe('cust-1');
    expect(sale?.initial_payment_method).toBe('cash');
    expect(sale?.paid_amount).toBe(30);
  });

  it('leaves the credit columns NULL for an ordinary cash sale', async () => {
    const { saleId } = await db.insertSale(base({ payment_method: 'cash' }));
    const sale = await db.getSaleWithItems(saleId);
    expect(sale?.payment_method).toBe('cash');
    expect(sale?.customer_client_id).toBeNull();
    expect(sale?.initial_payment_method).toBeNull();
  });

  it('still decrements stock for a credit sale (stock path unchanged)', async () => {
    await db.insertSale(base({ payment_method: 'credit', customer_client_id: 'cust-1' }));
    expect(fake.stockOf(1)).toBe(98);
  });
});
```

### Step 2.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-credit-sale.test.ts
```
Expected: the first two tests fail — `NewSaleInput` has no `customer_client_id`/`initial_payment_method` (this also surfaces as a `tsc` type error on `base()`), and even if constructed, `sale.customer_client_id` is `undefined` because the columns are neither written nor read.

### Step 2.3 — Extend the types in `db.ts`

In `NewSaleInput` (after `cashier_username: string | null;`) add:

```ts
  customer_client_id?: string | null;      // set for credit sales (references customers.client_customer_id)
  initial_payment_method?: string | null;  // 'cash'|'card'|'mobile' when the initial payment > 0
```

In `LocalSale` (after `cashier_username: string | null;`) add:

```ts
  customer_client_id: string | null;
  initial_payment_method: string | null;
```

In the internal `RawSaleRow` interface (after `cashier_username: string | null;`) add:

```ts
  customer_client_id: string | null;
  initial_payment_method: string | null;
```

**`SaleWithItems` (contract C-9):** no separate edit is needed — `SaleWithItems extends LocalSale`, and `getSaleWithItems` reads `SELECT * FROM sales`, so both new columns automatically flow through to `SaleWithItems.customer_client_id` / `SaleWithItems.initial_payment_method`. The first credit-sale test above is exactly the C-9 assertion: it calls `getSaleWithItems(saleId)` and asserts `sale?.customer_client_id === 'cust-1'` + `sale?.initial_payment_method === 'cash'` for a credit sale, and the cash-sale test asserts both are `null`. credit-sync `pushOnce` + credit-pos `SaleDetailPanel` consume these off `SaleWithItems`.

### Step 2.4 — Extend the `insertSaleRaw` INSERT

Replace the `INSERT INTO sales (...) VALUES (...)` call inside `insertSaleRaw` with the version below (two extra columns + two extra placeholders `$26`,`$27`, and the two extra bound values appended):

```ts
  await database.execute(
    `INSERT INTO sales
       (id, client_sale_id, idempotency_key, receipt_no, server_sale_id, subtotal,
        discount_amount, tax_amount, total_amount, paid_amount, change_amount,
        payment_method, card_type, notes, cashier_user_id, cashier_username,
        sync_status, error_kind, next_attempt_at, first_failed_at, last_error,
        retry_count, stock_applied, created_at_client, synced_at,
        customer_client_id, initial_payment_method)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [nextId, raw.client_sale_id, raw.idempotency_key, nextReceipt, raw.server_sale_id,
     raw.subtotal, raw.discount_amount, raw.tax_amount, raw.total_amount, raw.paid_amount,
     raw.change_amount, raw.payment_method, raw.card_type, raw.notes, raw.cashier_user_id,
     raw.cashier_username, raw.sync_status, raw.error_kind, raw.next_attempt_at,
     raw.first_failed_at, raw.last_error, raw.retry_count, stockApplied,
     raw.created_at_client, raw.synced_at,
     raw.customer_client_id, raw.initial_payment_method]
  );
```

### Step 2.5 — Map the new fields in `insertSale`

In `insertSale`, add the two fields to the `raw` object (place them right after `cashier_username: input.cashier_username,`):

```ts
    customer_client_id: input.customer_client_id ?? null,
    initial_payment_method: input.initial_payment_method ?? null,
```

### Step 2.6 — Keep the legacy backfill compiling

In `migrateOutboxToSalesOnce`, the `raw: RawSaleRow` object now needs the two new fields. Add them right after `cashier_username: null,`:

```ts
        customer_client_id: null,
        initial_payment_method: null,
```

### Step 2.7 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-credit-sale.test.ts src/lib/__tests__/db-sync-dao.test.ts
npx tsc --noEmit
```
Expected: all pass (including the untouched `db-sync-dao.test.ts` regression suite); `tsc` exits 0.

### Step 2.8 — Commit

```
feat(cashier): extend insertSale with credit fields (customer_client_id, initial_payment_method)
```

---

## Task 3: Customer types + `insertCustomer` / `getCustomerByClientId` / `getCustomers`

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-customers-dao.test.ts` (create)

### Step 3.1 — Write the failing customers-DAO test

Create `sellary-cashier/src/lib/__tests__/db-customers-dao.test.ts`:

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

describe('customers DAO', () => {
  it('insertCustomer generates a client id + timestamp and stores a pending, active row with balance 0', async () => {
    const { clientCustomerId } = await db.insertCustomer({ name: 'Ivan', phone: '+992900000001' });
    expect(clientCustomerId).toBeTruthy();          // db-generated uuid
    const row = await db.getCustomerByClientId(clientCustomerId);
    expect(row?.name).toBe('Ivan');
    expect(row?.phone).toBe('+992900000001');
    expect(row?.server_id).toBeNull();
    expect(row?.balance).toBe(0);
    expect(row?.is_active).toBe(1);
    expect(row?.sync_status).toBe('pending');
    expect(row?.retry_count).toBe(0);
    expect(row?.created_at_client).toBeTruthy();     // db-generated ISO timestamp
  });

  it('insertCustomer defaults optional fields to NULL', async () => {
    const { clientCustomerId } = await db.insertCustomer({ name: 'Solo' });
    const row = await db.getCustomerByClientId(clientCustomerId);
    expect(row?.phone).toBeNull();
    expect(row?.email).toBeNull();
    expect(row?.address).toBeNull();
    expect(row?.description).toBeNull();
  });

  it('getCustomerByClientId returns null for an unknown id', async () => {
    expect(await db.getCustomerByClientId('missing')).toBeNull();
  });

  it('getCustomers lists active customers alphabetically', async () => {
    await db.insertCustomer({ name: 'Boris', phone: '2' });
    await db.insertCustomer({ name: 'Anna', phone: '1' });
    const rows = await db.getCustomers();
    expect(rows.map((r) => r.name)).toEqual(['Anna', 'Boris']);
  });

  it('getCustomers filters by search on name or phone', async () => {
    await db.insertCustomer({ name: 'Anna', phone: '111' });
    await db.insertCustomer({ name: 'Boris', phone: '222' });
    expect((await db.getCustomers({ search: 'nna' })).map((r) => r.name)).toEqual(['Anna']);
    expect((await db.getCustomers({ search: '222' })).map((r) => r.name)).toEqual(['Boris']);
  });
});
```

### Step 3.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-customers-dao.test.ts
```
Expected: fails — `db.insertCustomer`, `db.getCustomerByClientId`, `db.getCustomers` are `undefined` (`TypeError: db.insertCustomer is not a function`), and `NewCustomerInput` is an unknown type (`tsc` error).

### Step 3.3 — Add the customer types + DAOs to `db.ts`

Append a new section at the end of `db.ts` (after `migrateOutboxToSalesOnce`):

```ts
// ---------------------------------------------------------------------------
// Offline customers + credit (migration 003) — spec §2, §5.4; contract C-1..C-3.
// Debt balance is DERIVED on read (§2.4): never stored beyond the last server pull.
// db.ts owns id/timestamp generation for local-origin rows (contract C-2/C-3).
// ---------------------------------------------------------------------------

// Caller supplies only user-entered fields; db.ts generates client_customer_id +
// created_at_client and sets sync_status='pending' (contract C-2).
export interface NewCustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
}

export interface LocalCustomer {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  balance: number;              // server-derived debt at last pull (NOT incl. local unsynced)
  is_active: number;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  next_attempt_at: string | null;
  first_failed_at: string | null;
  last_error: string | null;
  retry_count: number;
  created_at_client: string;
  synced_at: string | null;
  updated_at: string;
}

// Balance-bearing row returned by getCustomersWithLocalBalance (contract C-1). EXACT field set
// consumed by every UI plan — do NOT rename or extend it. sync_status/error_kind are plain
// strings here (widened) so consumers need not import SyncStatus/ErrorKind.
export type CustomerWithBalance = {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  local_balance: number;        // balance + Σ unsynced credit remaining − Σ unsynced payments (§2.4)
  is_active: number;
  sync_status: string;
  error_kind: string | null;
};

// Filter for getCustomers (the non-balance list). getCustomersWithLocalBalance is argument-less
// (contract C-1): the UI searches/filters the returned array client-side.
export interface CustomerFilter {
  search?: string;              // matches name OR phone
  limit?: number;
  offset?: number;
}

export async function insertCustomer(input: NewCustomerInput): Promise<{ clientCustomerId: string }> {
  const database = await getDb();
  const clientCustomerId = crypto.randomUUID();          // db.ts owns the local identity (C-2)
  const createdAtClient = new Date().toISOString();
  await database.execute(
    `INSERT INTO customers
       (client_customer_id, server_id, name, phone, email, address, description,
        balance, is_active, sync_status, retry_count, created_at_client)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, 0, 1, 'pending', 0, $7)`,
    [clientCustomerId, input.name, input.phone ?? null, input.email ?? null,
     input.address ?? null, input.description ?? null, createdAtClient]
  );
  return { clientCustomerId };
}

export async function getCustomerByClientId(clientCustomerId: string): Promise<LocalCustomer | null> {
  const database = await getDb();
  const rows = await database.select<LocalCustomer[]>(
    'SELECT * FROM customers WHERE client_customer_id = $1',
    [clientCustomerId]
  );
  return rows[0] || null;
}

export async function getCustomers(filter: CustomerFilter = {}): Promise<LocalCustomer[]> {
  const database = await getDb();
  const where: string[] = ['is_active = 1'];
  const params: unknown[] = [];
  if (filter.search) {
    const q = `%${filter.search}%`;
    params.push(q); const p1 = params.length;
    params.push(q); const p2 = params.length;
    where.push(`(name LIKE $${p1} OR phone LIKE $${p2})`);
  }
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;
  params.push(limit); const lp = params.length;
  params.push(offset); const op = params.length;
  return database.select<LocalCustomer[]>(
    `SELECT * FROM customers WHERE ${where.join(' AND ')}
     ORDER BY name ASC LIMIT $${lp} OFFSET $${op}`,
    params
  );
}
```

### Step 3.4 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-customers-dao.test.ts
npx tsc --noEmit
```
Expected: 5 passed; `tsc` exits 0.

### Step 3.5 — Commit

```
feat(cashier): add customer types + insertCustomer/getCustomerByClientId/getCustomers DAOs
```

---

## Task 4: Payment outbox — `insertCustomerPayment` + `getCustomerLedgerLocal`

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-customer-payments-dao.test.ts` (create)

### Step 4.1 — Write the failing payment-outbox test

Create `sellary-cashier/src/lib/__tests__/db-customer-payments-dao.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

async function seedCreditSale(clientSaleId: string, total: number, paid: number, when: string) {
  await db.insertSale({
    client_sale_id: clientSaleId, idempotency_key: clientSaleId,
    subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
    paid_amount: paid, change_amount: 0, payment_method: 'credit', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    customer_client_id: 'cust-1', initial_payment_method: paid > 0 ? 'cash' : null,
    created_at_client: when,
    items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 1,
      unit_price: total, tax_percent: 0, line_subtotal: total, line_total: total, sort_order: 0 }],
  });
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  db = await import('../db');
});

describe('customer payment outbox', () => {
  it('insertCustomerPayment generates ids + timestamp and stores a pending outbox row', async () => {
    const { clientPaymentId } = await db.insertCustomerPayment({
      customer_client_id: 'cust-1', amount: 40, payment_method: 'cash',
    });
    expect(clientPaymentId).toBeTruthy();          // db-generated uuid
    const rows = await fake.select<import('../db').LocalCustomerPayment[]>(
      'SELECT * FROM customer_payments WHERE client_payment_id = $1', [clientPaymentId]);
    expect(rows[0].amount).toBe(40);
    expect(rows[0].sync_status).toBe('pending');
    expect(rows[0].applied_amount).toBeNull();
    expect(rows[0].idempotency_key).toBeTruthy();  // db-generated
    expect(rows[0].created_at_client).toBeTruthy();
  });

  it('getCustomerLedgerLocal merges credit sales + payments newest-first with SIGNED amounts', async () => {
    await seedCreditSale('s-1', 100, 30, '2025-01-01T08:00:00.000Z');
    await db.insertCustomerPayment({ customer_client_id: 'cust-1', amount: 20, payment_method: 'cash' });
    const ledger = await db.getCustomerLedgerLocal('cust-1');
    // the payment carries a db-generated (current-date) timestamp → newest-first
    expect(ledger.map((e) => e.kind)).toEqual(['payment', 'credit_sale']);
    const sale = ledger.find((e) => e.kind === 'credit_sale');
    expect(sale?.ref_id).toBe('s-1');
    expect(sale?.amount).toBe(70);              // SIGNED: +remaining (100 − 30)
    expect(sale?.receipt_no).not.toBeNull();    // receipt of the credit sale
    expect(sale?.applied_amount).toBeNull();
    const pmt = ledger.find((e) => e.kind === 'payment');
    expect(pmt?.amount).toBe(-20);              // SIGNED: −amount
    expect(pmt?.receipt_no).toBeNull();
    expect(pmt?.applied_amount).toBeNull();     // null until synced/capped
  });
});
```

### Step 4.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-customer-payments-dao.test.ts
```
Expected: fails — `db.insertCustomerPayment` and `db.getCustomerLedgerLocal` are `undefined`, and `NewPaymentInput`/`LocalLedgerEntry` are unknown (`tsc` error). (The first case reads the row directly via `fake.select`, so it does not depend on `getSendablePayments`, which arrives in Task 8.)

### Step 4.3 — Add payment types + DAOs to `db.ts`

Append after the `getCustomers` DAO from Task 3:

```ts
// Caller supplies only user-entered fields; db.ts generates client_payment_id + idempotency_key +
// created_at_client and sets sync_status='pending' (contract C-3).
export interface NewPaymentInput {
  customer_client_id: string;   // references customers.client_customer_id
  amount: number;
  payment_method: string;       // 'cash'|'card'|'mobile'
  description?: string | null;
}

export interface LocalCustomerPayment {
  client_payment_id: string;
  idempotency_key: string;
  customer_client_id: string;
  amount: number;
  payment_method: string;
  description: string | null;
  applied_amount: number | null;   // server-applied (may be < amount if capped-to-balance)
  server_customer_id: number | null;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  next_attempt_at: string | null;
  first_failed_at: string | null;
  last_error: string | null;
  retry_count: number;
  created_at_client: string;
  synced_at: string | null;
}

// One ledger row for the customer-detail view (contract C-4). `amount` is SIGNED:
// credit_sale = +remaining (total − initial paid), payment = −amount. receipt_no is the
// credit sale's receipt (null for payments); applied_amount is the payment's server-capped
// amount (null for sales, and null on a payment until it syncs / is capped).
export interface LocalLedgerEntry {
  ref_id: string;                    // client_sale_id or client_payment_id
  kind: 'credit_sale' | 'payment';
  amount: number;                    // SIGNED (see above)
  description: string | null;
  receipt_no: number | null;
  applied_amount: number | null;
  created_at_client: string;
  sync_status: string;
  error_kind: string | null;
}

export async function insertCustomerPayment(input: NewPaymentInput): Promise<{ clientPaymentId: string }> {
  const database = await getDb();
  const clientPaymentId = crypto.randomUUID();           // db.ts owns the local identity (C-3)
  const idempotencyKey = crypto.randomUUID();
  const createdAtClient = new Date().toISOString();
  await database.execute(
    `INSERT INTO customer_payments
       (client_payment_id, idempotency_key, customer_client_id, amount,
        payment_method, description, sync_status, retry_count, created_at_client)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7)`,
    [clientPaymentId, idempotencyKey, input.customer_client_id,
     input.amount, input.payment_method, input.description ?? null, createdAtClient]
  );
  return { clientPaymentId };
}

export async function getCustomerLedgerLocal(clientCustomerId: string): Promise<LocalLedgerEntry[]> {
  const database = await getDb();
  const sales = await database.select<{
    client_sale_id: string; receipt_no: number | null; total_amount: number; paid_amount: number;
    notes: string | null; sync_status: string; error_kind: string | null; created_at_client: string;
  }[]>(
    `SELECT client_sale_id, receipt_no, total_amount, paid_amount, notes,
            sync_status, error_kind, created_at_client
     FROM sales
     WHERE customer_client_id = $1 AND payment_method = 'credit'`,
    [clientCustomerId]
  );
  const pays = await database.select<{
    client_payment_id: string; amount: number; description: string | null;
    applied_amount: number | null; sync_status: string; error_kind: string | null;
    created_at_client: string;
  }[]>(
    `SELECT client_payment_id, amount, description, applied_amount,
            sync_status, error_kind, created_at_client
     FROM customer_payments
     WHERE customer_client_id = $1`,
    [clientCustomerId]
  );
  const entries: LocalLedgerEntry[] = [];
  for (const s of sales) {
    entries.push({
      ref_id: s.client_sale_id,
      kind: 'credit_sale',
      amount: s.total_amount - s.paid_amount,   // SIGNED: +remaining
      description: s.notes,
      receipt_no: s.receipt_no,
      applied_amount: null,
      created_at_client: s.created_at_client,
      sync_status: s.sync_status,
      error_kind: s.error_kind,
    });
  }
  for (const p of pays) {
    entries.push({
      ref_id: p.client_payment_id,
      kind: 'payment',
      amount: -p.amount,                        // SIGNED: −amount
      description: p.description,
      receipt_no: null,
      applied_amount: p.applied_amount,
      created_at_client: p.created_at_client,
      sync_status: p.sync_status,
      error_kind: p.error_kind,
    });
  }
  entries.sort((a, b) => (a.created_at_client < b.created_at_client ? 1 : -1));
  return entries;
}
```

### Step 4.4 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-customer-payments-dao.test.ts
npx tsc --noEmit
```
Expected: 2 passed; `tsc` exits 0.

### Step 4.5 — Commit

```
feat(cashier): add customer payment outbox DAO + local ledger view
```

---

## Task 5: Local-balance derivation — `getCustomerLocalBalance` / `getCustomersWithLocalBalance`

Implements spec §2.4: `local_balance = customers.balance + Σ remaining of unsynced credit sales − Σ unsynced payments`. "Unsynced" means `sync_status != 'synced'` (pending + syncing + failed, incl. permanent), mirroring the Phase-1 stock reconcile which sums over all non-synced sales.

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-customer-balance.test.ts` (create)

### Step 5.1 — Write the failing balance-derivation test

Create `sellary-cashier/src/lib/__tests__/db-customer-balance.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');
let custId: string;

async function creditSale(clientSaleId: string, total: number, paid: number) {
  return db.insertSale({
    client_sale_id: clientSaleId, idempotency_key: clientSaleId,
    subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
    paid_amount: paid, change_amount: 0, payment_method: 'credit', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    customer_client_id: custId, initial_payment_method: paid > 0 ? 'cash' : null,
    created_at_client: '2025-01-01T08:00:00.000Z',
    items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 1,
      unit_price: total, tax_percent: 0, line_subtotal: total, line_total: total, sort_order: 0 }],
  });
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 1000 });
  db = await import('../db');
  ({ clientCustomerId: custId } = await db.insertCustomer({ name: 'Ivan', phone: '1' }));
});

describe('local balance derivation (§2.4)', () => {
  it('is 0 for a fresh customer with no credit sales', async () => {
    expect(await db.getCustomerLocalBalance(custId)).toBe(0);
  });

  it('adds Σ unsynced credit remaining and subtracts Σ unsynced payments', async () => {
    await creditSale('s-1', 100, 30);                        // remaining 70
    expect(await db.getCustomerLocalBalance(custId)).toBe(70);
    await db.insertCustomerPayment({ customer_client_id: custId, amount: 20, payment_method: 'cash' });
    expect(await db.getCustomerLocalBalance(custId)).toBe(50);
  });

  it('layers unsynced deltas on top of the pulled server balance', async () => {
    // Simulate a prior server pull: raw server balance = 200.
    await fake.execute('UPDATE customers SET balance = $1 WHERE client_customer_id = $2',
      [200, custId]);
    const { saleId } = await creditSale('s-1', 100, 30);     // unsynced remaining 70
    await db.insertCustomerPayment({ customer_client_id: custId, amount: 20, payment_method: 'cash' });
    expect(await db.getCustomerLocalBalance(custId)).toBe(250);   // 200 + 70 − 20
    // Once the sale syncs it is folded into the server balance → no longer a local delta.
    await db.markSaleSynced(saleId, 999);
    expect(await db.getCustomerLocalBalance(custId)).toBe(180);   // 200 + 0 − 20
  });

  it('getCustomersWithLocalBalance (argument-less) returns every active customer with local_balance', async () => {
    await creditSale('s-1', 100, 30);                        // Ivan → local_balance 70
    await db.insertCustomer({ name: 'Boris', phone: '2' });  // → local_balance 0
    const all = await db.getCustomersWithLocalBalance();
    expect(all.map((c) => c.name)).toEqual(['Boris', 'Ivan']);   // ordered by name
    expect(all.find((c) => c.name === 'Ivan')?.local_balance).toBe(70);
    expect(all.find((c) => c.name === 'Boris')?.local_balance).toBe(0);
    // Debt tabs / search are applied client-side by the UI over this array (contract C-1).
  });
});
```

### Step 5.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-customer-balance.test.ts
```
Expected: fails — `db.getCustomerLocalBalance` and `db.getCustomersWithLocalBalance` are `undefined`.

### Step 5.3 — Add the derivation DAOs to `db.ts`

Append after `getCustomerLedgerLocal`:

```ts
// Read-time debt derivation (§2.4). "Unsynced" = sync_status != 'synced' (pending/syncing/failed,
// incl. permanent), mirroring the stock reconcile: server value + local-unsynced delta.
const LOCAL_BALANCE_EXPR = `
  c.balance
  + COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM sales s
       WHERE s.customer_client_id = c.client_customer_id
         AND s.payment_method = 'credit'
         AND s.sync_status != 'synced'), 0)
  - COALESCE((SELECT SUM(p.amount) FROM customer_payments p
       WHERE p.customer_client_id = c.client_customer_id
         AND p.sync_status != 'synced'), 0)`;

export async function getCustomerLocalBalance(clientCustomerId: string): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ local_balance: number }[]>(
    `SELECT (${LOCAL_BALANCE_EXPR}) AS local_balance
     FROM customers c WHERE c.client_customer_id = $1`,
    [clientCustomerId]
  );
  return rows[0]?.local_balance ?? 0;
}

// Argument-less (contract C-1): returns EVERY active customer with its derived local_balance,
// ordered by name. The UI applies search + debt tabs (Все / Есть долг / Нет долга) client-side
// over this array — no server-style filter/pagination params here.
export async function getCustomersWithLocalBalance(): Promise<CustomerWithBalance[]> {
  const database = await getDb();
  return database.select<CustomerWithBalance[]>(
    `SELECT c.client_customer_id, c.server_id, c.name, c.phone, c.email, c.address,
            c.description, c.is_active, c.sync_status, c.error_kind,
            (${LOCAL_BALANCE_EXPR}) AS local_balance
     FROM customers c
     WHERE c.is_active = 1
     ORDER BY c.name ASC`
  );
}
```

### Step 5.4 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-customer-balance.test.ts
npx tsc --noEmit
```
Expected: 4 passed; `tsc` exits 0.

### Step 5.5 — Commit

```
feat(cashier): derive customer debt on read (getCustomerLocalBalance/getCustomersWithLocalBalance)
```

---

## Task 6: Bootstrap + reconcile — `upsertServerCustomers` / `reconcileCustomerBalances`

Pulled (existing) customers land locally with `client_customer_id = item.client_customer_id ?? srv:<id>`, `server_id` set, `sync_status='synced'`, and the raw server `balance`. Reconcile is a raw balance overwrite; the read-time derivation (Task 5) re-applies unsynced deltas, so pulling raw balances is idempotent (mirrors the stock rule — the only "subtractor" is the read-time derivation, never a stored double-count).

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-customer-reconcile.test.ts` (create)

### Step 6.1 — Write the failing reconcile test

Create `sellary-cashier/src/lib/__tests__/db-customer-reconcile.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function server(over: Partial<import('../db').ServerCustomerItem> = {}): import('../db').ServerCustomerItem {
  return {
    id: over.id ?? 10,
    client_customer_id: over.client_customer_id ?? null,
    name: over.name ?? 'Ivan',
    phone: over.phone ?? '+992900000001',
    email: over.email ?? null,
    address: over.address ?? null,
    description: over.description ?? null,
    balance: over.balance ?? 0,
    is_active: over.is_active ?? true,
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 1000 });
  db = await import('../db');
});

describe('bootstrap upsert + reconcile', () => {
  it('upsertServerCustomers inserts a synced row keyed by srv:<id> when no client id', async () => {
    await db.upsertServerCustomers([server({ id: 10, balance: 150 })]);
    const row = await db.getCustomerByClientId('srv:10');
    expect(row?.server_id).toBe(10);
    expect(row?.balance).toBe(150);
    expect(row?.sync_status).toBe('synced');
    expect(row?.is_active).toBe(1);
  });

  it('upsertServerCustomers reuses the offline client id when the server echoes it', async () => {
    const { clientCustomerId } = await db.insertCustomer({ name: 'Ivan', phone: '1' });
    await db.upsertServerCustomers([server({ id: 42, client_customer_id: clientCustomerId, balance: 90 })]);
    const rows = await db.getCustomers();
    expect(rows).toHaveLength(1);               // merged, not duplicated
    expect(rows[0].client_customer_id).toBe(clientCustomerId);
    expect(rows[0].server_id).toBe(42);
    expect(rows[0].balance).toBe(90);
    expect(rows[0].sync_status).toBe('synced');
  });

  it('reconcileCustomerBalances overwrites raw balance and is idempotent under unsynced deltas', async () => {
    await db.upsertServerCustomers([server({ id: 10, balance: 100 })]);
    // Add an unsynced payment of 30 for this pulled customer.
    await db.insertCustomerPayment({ customer_client_id: 'srv:10', amount: 30, payment_method: 'cash' });
    expect(await db.getCustomerLocalBalance('srv:10')).toBe(70);     // 100 − 30
    // Reconcile with the same raw server balance twice — derived balance must not drift.
    await db.reconcileCustomerBalances([server({ id: 10, balance: 100 })]);
    await db.reconcileCustomerBalances([server({ id: 10, balance: 100 })]);
    expect(await db.getCustomerLocalBalance('srv:10')).toBe(70);     // still 100 − 30
    // A new raw server balance is adopted verbatim.
    await db.reconcileCustomerBalances([server({ id: 10, balance: 40 })]);
    expect(await db.getCustomerLocalBalance('srv:10')).toBe(10);     // 40 − 30
  });
});
```

### Step 6.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-customer-reconcile.test.ts
```
Expected: fails — `db.upsertServerCustomers`, `db.reconcileCustomerBalances` undefined; `ServerCustomerItem` unknown (`tsc` error).

### Step 6.3 — Add `ServerCustomerItem` + the two DAOs to `db.ts`

Append after `getCustomersWithLocalBalance`:

```ts
// Shape of a customer row shipped by GET /api/sync/bootstrap (spec C3). balance = server-derived
// debt at pull time; client_customer_id is null for server/web-origin customers (synthesize srv:<id>).
export interface ServerCustomerItem {
  id: number;
  client_customer_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  balance: number;
  is_active: boolean;
}

function serverClientId(item: ServerCustomerItem): string {
  return item.client_customer_id ?? `srv:${item.id}`;
}

export async function upsertServerCustomers(items: ServerCustomerItem[]): Promise<void> {
  const database = await getDb();
  for (const it of items) {
    const clientId = serverClientId(it);
    await database.execute(
      `INSERT INTO customers
         (client_customer_id, server_id, name, phone, email, address, description,
          balance, is_active, sync_status, retry_count, created_at_client, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'synced', 0, datetime('now'), datetime('now'))
       ON CONFLICT(client_customer_id) DO UPDATE SET
         server_id   = excluded.server_id,
         name        = excluded.name,
         phone       = excluded.phone,
         email       = excluded.email,
         address     = excluded.address,
         description = excluded.description,
         balance     = excluded.balance,
         is_active   = excluded.is_active,
         sync_status = 'synced',
         synced_at   = datetime('now'),
         updated_at  = datetime('now')`,
      [clientId, it.id, it.name, it.phone, it.email, it.address, it.description,
       it.balance, it.is_active ? 1 : 0]
    );
  }
}

// Raw server-balance overwrite only (§4 step 4). Derivation stays at read time (§2.4),
// so replaying the same server balances never double-counts.
export async function reconcileCustomerBalances(serverCustomers: ServerCustomerItem[]): Promise<void> {
  const database = await getDb();
  for (const sc of serverCustomers) {
    await database.execute(
      `UPDATE customers SET balance = $1, updated_at = datetime('now')
       WHERE client_customer_id = $2`,
      [sc.balance, serverClientId(sc)]
    );
  }
}
```

### Step 6.4 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-customer-reconcile.test.ts
npx tsc --noEmit
```
Expected: 3 passed; `tsc` exits 0.

### Step 6.5 — Commit

```
feat(cashier): add upsertServerCustomers + reconcileCustomerBalances (bootstrap pull)
```

---

## Task 7: Customer sync-worker DAOs + `applyCustomerIdMap`

Mirrors the Phase-1 sales sync-worker DAOs exactly (same pending / due-transient / force-permanent semantics + backoff), operating on the `customers` table keyed by `client_customer_id`.

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-customer-sync-dao.test.ts` (create)

### Step 7.1 — Write the failing customer-sync test

Create `sellary-cashier/src/lib/__tests__/db-customer-sync-dao.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

// insertCustomer now generates the id + created_at_client (contract C-2), so we capture the
// returned id and stamp a deterministic created_at_client via raw SQL for ordering assertions.
async function newCustomer(name: string, when: string): Promise<string> {
  const { clientCustomerId } = await db.insertCustomer({ name, phone: name });
  await fake.execute(
    'UPDATE customers SET created_at_client = $1 WHERE client_customer_id = $2',
    [when, clientCustomerId]
  );
  return clientCustomerId;
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  db = await import('../db');
});

describe('customer sync-worker DAOs', () => {
  it('getSendableCustomers returns pending oldest-first; excludes future/permanent', async () => {
    const c2 = await newCustomer('B', '2025-01-01T09:00:00.000Z');
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    const fut = await newCustomer('F', '2025-01-01T07:00:00.000Z');
    const perm = await newCustomer('P', '2025-01-01T06:00:00.000Z');
    await db.markCustomerTransientFailure([fut], '2025-01-01T23:00:00.000Z', 'net');
    await db.markCustomerPermanentFailure(perm, 'dup');
    const sendable = await db.getSendableCustomers('2025-01-01T10:00:00.000Z');
    expect(sendable.map((c) => c.client_customer_id)).toEqual([c1, c2]);
  });

  it('getSendableCustomers with includePermanent also returns permanent failures', async () => {
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    const perm = await newCustomer('P', '2025-01-01T06:00:00.000Z');
    await db.markCustomerPermanentFailure(perm, 'dup');
    const forced = await db.getSendableCustomers('2025-01-01T10:00:00.000Z', { includePermanent: true });
    expect(forced.map((c) => c.client_customer_id).sort()).toEqual([c1, perm].sort());
  });

  it('markCustomerSyncing → recoverSyncingCustomers moves back to failed+transient', async () => {
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    await db.markCustomerSyncing(c1);
    expect((await db.getCustomerByClientId(c1))?.sync_status).toBe('syncing');
    const n = await db.recoverSyncingCustomers('2025-01-01T10:00:00.000Z');
    expect(n).toBe(1);
    const row = await db.getCustomerByClientId(c1);
    expect(row?.sync_status).toBe('failed');
    expect(row?.error_kind).toBe('transient');
    expect(row?.next_attempt_at).toBe('2025-01-01T10:00:00.000Z');
  });

  it('getUnsyncedCustomerCount counts pending+syncing+transient, excludes permanent', async () => {
    await newCustomer('A', '2025-01-01T08:00:00.000Z');            // pending
    const trans = await newCustomer('B', '2025-01-01T08:00:00.000Z');
    const perm = await newCustomer('C', '2025-01-01T08:00:00.000Z');
    await db.markCustomerTransientFailure([trans], '2025-01-01T07:00:00.000Z', 'net');
    await db.markCustomerPermanentFailure(perm, 'dup');
    expect(await db.getUnsyncedCustomerCount()).toBe(2);
  });

  it('applyCustomerIdMap sets server_id + marks synced for synced/duplicate results', async () => {
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    const c2 = await newCustomer('B', '2025-01-01T08:00:00.000Z');
    const c3 = await newCustomer('C', '2025-01-01T08:00:00.000Z');
    // Inline literals structurally match SyncCustomerResult (api.ts, contract C-7).
    await db.applyCustomerIdMap([
      { client_customer_id: c1, status: 'synced', server_id: 501 },
      { client_customer_id: c2, status: 'duplicate', server_id: 502 },
      { client_customer_id: c3, status: 'failed', server_id: null, error: 'boom' },
    ]);
    expect((await db.getCustomerByClientId(c1))?.server_id).toBe(501);
    expect((await db.getCustomerByClientId(c1))?.sync_status).toBe('synced');
    expect((await db.getCustomerByClientId(c2))?.server_id).toBe(502);
    expect((await db.getCustomerByClientId(c2))?.sync_status).toBe('synced');
    expect((await db.getCustomerByClientId(c3))?.server_id).toBeNull();
    expect((await db.getCustomerByClientId(c3))?.sync_status).toBe('pending'); // failed left for the engine
  });
});
```

### Step 7.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-customer-sync-dao.test.ts
```
Expected: fails — `db.getSendableCustomers`, `markCustomer*`, `recoverSyncingCustomers`, `getUnsyncedCustomerCount`, `applyCustomerIdMap` undefined.

### Step 7.3 — Add the customer sync-worker DAOs to `db.ts`

First, at the **top of `db.ts`** (below the existing `import Database` line), add the type-only import for the api-owned result types (contract C-7 — do NOT define them in db.ts):

```ts
import type { SyncCustomerResult, SyncPaymentResult } from './api';
```

> `SyncCustomerResult` = `{ client_customer_id: string; status: 'synced'|'duplicate'|'failed'; server_id?: number | null; error?: string | null }` and `SyncPaymentResult` = `{ client_payment_id: string; status: 'synced'|'duplicate'|'failed'; applied_amount?: number | null; warnings?: SyncPaymentWarning[] | null; error?: string | null }` are defined in `src/lib/api.ts` by the **credit-sync** plan (mirroring the existing `SyncSaleResult`). Because credit-sync merges after this plan, land these two `export interface`s in `api.ts` as the first step here so `tsc` is green on the data-model branch (see the header contract note).

Then append the DAOs after `reconcileCustomerBalances`:

```ts
// Default: pending OR (failed & transient & due). includePermanent adds failed & permanent
// (force resend). Mirrors getSendableSales (§4.2).
export async function getSendableCustomers(
  nowIso: string,
  opts?: { includePermanent?: boolean }
): Promise<LocalCustomer[]> {
  const database = await getDb();
  const permanentClause = opts?.includePermanent
    ? " OR (sync_status = 'failed' AND error_kind = 'permanent')"
    : '';
  return database.select<LocalCustomer[]>(
    `SELECT * FROM customers
     WHERE sync_status = 'pending'
        OR (sync_status = 'failed' AND error_kind = 'transient'
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1))${permanentClause}
     ORDER BY created_at_client ASC, client_customer_id ASC`,
    [nowIso]
  );
}

export async function markCustomerSyncing(clientCustomerId: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    "UPDATE customers SET sync_status = 'syncing', updated_at = datetime('now') WHERE client_customer_id = $1",
    [clientCustomerId]
  );
}

export async function markCustomerSynced(clientCustomerId: string, serverId: number | null): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE customers
     SET sync_status = 'synced', server_id = $1, error_kind = NULL,
         next_attempt_at = NULL, last_error = NULL,
         synced_at = datetime('now'), updated_at = datetime('now')
     WHERE client_customer_id = $2`,
    [serverId, clientCustomerId]
  );
}

export async function markCustomerTransientFailure(
  clientCustomerIds: string[], nextAttemptAt: string, error: string
): Promise<void> {
  if (clientCustomerIds.length === 0) return;
  const database = await getDb();
  for (const id of clientCustomerIds) {
    await database.execute(
      `UPDATE customers
       SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
           last_error = $2, retry_count = retry_count + 1,
           first_failed_at = COALESCE(first_failed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE client_customer_id = $3`,
      [nextAttemptAt, error, id]
    );
  }
}

export async function markCustomerPermanentFailure(clientCustomerId: string, error: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE customers
     SET sync_status = 'failed', error_kind = 'permanent', next_attempt_at = NULL,
         last_error = $1, retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now')),
         updated_at = datetime('now')
     WHERE client_customer_id = $2`,
    [error, clientCustomerId]
  );
}

export async function recoverSyncingCustomers(nowIso: string): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE customers
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

export async function getUnsyncedCustomerCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM customers
     WHERE sync_status IN ('pending','syncing')
        OR (sync_status = 'failed' AND error_kind = 'transient')`
  );
  return rows[0]?.c ?? 0;
}

// Apply {client_customer_id → server_id} from a push result: set server_id + mark synced for
// synced/duplicate ONLY (contract C-6). failed rows are left untouched — the credit-sync engine
// classifies them and calls markCustomer{Transient,Permanent}Failure itself.
export async function applyCustomerIdMap(results: SyncCustomerResult[]): Promise<void> {
  for (const r of results) {
    if ((r.status === 'synced' || r.status === 'duplicate') && r.server_id != null) {
      await markCustomerSynced(r.client_customer_id, r.server_id);
    }
  }
}
```

### Step 7.4 — Run and see it PASS

```
npx vitest run src/lib/__tests__/db-customer-sync-dao.test.ts
npx tsc --noEmit
```
Expected: 5 passed; `tsc` exits 0.

### Step 7.5 — Commit

```
feat(cashier): add customer sync-worker DAOs + applyCustomerIdMap
```

---

## Task 8: Payment sync-worker DAOs + `applyPaymentResults`

Same pattern, operating on `customer_payments` keyed by `client_payment_id`. Success is applied via `applyPaymentResults` (it carries the server-capped `applied_amount`); `markPaymentSynced` exists for symmetry with the sales worker.

**Files:**
- `sellary-cashier/src/lib/db.ts` (modify)
- `sellary-cashier/src/lib/__tests__/db-payment-sync-dao.test.ts` (create)

### Step 8.1 — Write the failing payment-sync test

Create `sellary-cashier/src/lib/__tests__/db-payment-sync-dao.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

// insertCustomerPayment now generates the id + created_at_client (contract C-3), so capture the
// returned id and stamp a deterministic created_at_client via raw SQL for ordering assertions.
async function pay(amount: number, when: string): Promise<string> {
  const { clientPaymentId } = await db.insertCustomerPayment({
    customer_client_id: 'cust-1', amount, payment_method: 'cash',
  });
  await fake.execute(
    'UPDATE customer_payments SET created_at_client = $1 WHERE client_payment_id = $2',
    [when, clientPaymentId]
  );
  return clientPaymentId;
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  db = await import('../db');
});

describe('payment sync-worker DAOs', () => {
  it('getSendablePayments returns pending oldest-first; excludes future/permanent', async () => {
    const p2 = await pay(20, '2025-01-01T09:00:00.000Z');
    const p1 = await pay(10, '2025-01-01T08:00:00.000Z');
    const fut = await pay(30, '2025-01-01T07:00:00.000Z');
    const perm = await pay(40, '2025-01-01T06:00:00.000Z');
    await db.markPaymentTransientFailure([fut], '2025-01-01T23:00:00.000Z', 'net');
    await db.markPaymentPermanentFailure(perm, 'no customer');
    const sendable = await db.getSendablePayments('2025-01-01T10:00:00.000Z');
    expect(sendable.map((p) => p.client_payment_id)).toEqual([p1, p2]);
  });

  it('getSendablePayments with includePermanent also returns permanent failures', async () => {
    const p1 = await pay(10, '2025-01-01T08:00:00.000Z');
    const perm = await pay(40, '2025-01-01T06:00:00.000Z');
    await db.markPaymentPermanentFailure(perm, 'no customer');
    const forced = await db.getSendablePayments('2025-01-01T10:00:00.000Z', { includePermanent: true });
    expect(forced.map((p) => p.client_payment_id).sort()).toEqual([p1, perm].sort());
  });

  it('recoverSyncingPayments moves syncing → failed+transient and returns the count', async () => {
    const p1 = await pay(10, '2025-01-01T08:00:00.000Z');
    await db.markPaymentSyncing(p1);
    const n = await db.recoverSyncingPayments('2025-01-01T10:00:00.000Z');
    expect(n).toBe(1);
    const rows = await db.getSendablePayments('2025-01-01T10:00:00.000Z');
    expect(rows[0].error_kind).toBe('transient');
    expect(rows[0].next_attempt_at).toBe('2025-01-01T10:00:00.000Z');
  });

  it('getUnsyncedPaymentCount counts pending+syncing+transient, excludes permanent', async () => {
    await pay(10, '2025-01-01T08:00:00.000Z');            // pending
    const trans = await pay(20, '2025-01-01T08:00:00.000Z');
    const perm = await pay(30, '2025-01-01T08:00:00.000Z');
    await db.markPaymentTransientFailure([trans], '2025-01-01T07:00:00.000Z', 'net');
    await db.markPaymentPermanentFailure(perm, 'no customer');
    expect(await db.getUnsyncedPaymentCount()).toBe(2);
  });

  it('applyPaymentResults sets applied_amount + marks synced (capped amount preserved)', async () => {
    const p1 = await pay(100, '2025-01-01T08:00:00.000Z');   // requested 100
    const p2 = await pay(50, '2025-01-01T08:30:00.000Z');
    // Inline literals structurally match SyncPaymentResult (api.ts, contract C-7).
    await db.applyPaymentResults([
      { client_payment_id: p1, status: 'synced', applied_amount: 70 },   // capped-to-balance
      { client_payment_id: p2, status: 'duplicate', applied_amount: 50 },
    ]);
    const rows = await fake.select<import('../db').LocalCustomerPayment[]>(
      'SELECT * FROM customer_payments');
    expect(rows.find((r) => r.client_payment_id === p1)?.sync_status).toBe('synced');
    expect(rows.find((r) => r.client_payment_id === p1)?.applied_amount).toBe(70);
    expect(rows.find((r) => r.client_payment_id === p2)?.sync_status).toBe('synced');
    expect(rows.find((r) => r.client_payment_id === p2)?.applied_amount).toBe(50);
  });
});

describe('combined credit outbox counts (contract C-5)', () => {
  it('getUnsyncedCreditCount sums pending+syncing+transient across customers + payments', async () => {
    await db.insertCustomer({ name: 'A', phone: '1' });                    // pending customer (+1)
    await pay(10, '2025-01-01T08:00:00.000Z');                             // pending payment (+1)
    const trans = await pay(20, '2025-01-01T08:00:00.000Z');
    await db.markPaymentTransientFailure([trans], '2025-01-01T07:00:00.000Z', 'net'); // transient payment (+1)
    const permC = (await db.insertCustomer({ name: 'B', phone: '2' })).clientCustomerId;
    await db.markCustomerPermanentFailure(permC, 'dup');                   // permanent customer (excluded)
    expect(await db.getUnsyncedCreditCount()).toBe(3);                     // 1 customer + 2 payments
  });

  it('getNeedsAttentionCreditCount counts permanent failures across customers + payments', async () => {
    const permC = (await db.insertCustomer({ name: 'B', phone: '2' })).clientCustomerId;
    await db.markCustomerPermanentFailure(permC, 'dup');                   // permanent customer (+1)
    const permP = await pay(40, '2025-01-01T06:00:00.000Z');
    await db.markPaymentPermanentFailure(permP, 'no customer');            // permanent payment (+1)
    await pay(10, '2025-01-01T08:00:00.000Z');                             // pending payment (excluded)
    expect(await db.getNeedsAttentionCreditCount()).toBe(2);              // 1 customer + 1 payment
  });
});
```

### Step 8.2 — Run and see it FAIL

```
npx vitest run src/lib/__tests__/db-payment-sync-dao.test.ts
```
Expected: fails — `db.getSendablePayments`, `markPayment*`, `recoverSyncingPayments`, `getUnsyncedPaymentCount`, `applyPaymentResults`, `getUnsyncedCreditCount`, `getNeedsAttentionCreditCount` undefined.

### Step 8.3 — Add the payment sync-worker DAOs to `db.ts`

Append after `applyCustomerIdMap` (`SyncPaymentResult` is the api-owned type imported at the top of `db.ts` in Step 7.3 — do NOT redefine it here, contract C-7):

```ts
export async function getSendablePayments(
  nowIso: string,
  opts?: { includePermanent?: boolean }
): Promise<LocalCustomerPayment[]> {
  const database = await getDb();
  const permanentClause = opts?.includePermanent
    ? " OR (sync_status = 'failed' AND error_kind = 'permanent')"
    : '';
  return database.select<LocalCustomerPayment[]>(
    `SELECT * FROM customer_payments
     WHERE sync_status = 'pending'
        OR (sync_status = 'failed' AND error_kind = 'transient'
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1))${permanentClause}
     ORDER BY created_at_client ASC, client_payment_id ASC`,
    [nowIso]
  );
}

export async function markPaymentSyncing(clientPaymentId: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    "UPDATE customer_payments SET sync_status = 'syncing' WHERE client_payment_id = $1",
    [clientPaymentId]
  );
}

export async function markPaymentSynced(
  clientPaymentId: string, appliedAmount: number | null, serverCustomerId: number | null
): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE customer_payments
     SET sync_status = 'synced', applied_amount = $1, server_customer_id = $2,
         error_kind = NULL, next_attempt_at = NULL, last_error = NULL,
         synced_at = datetime('now')
     WHERE client_payment_id = $3`,
    [appliedAmount, serverCustomerId, clientPaymentId]
  );
}

export async function markPaymentTransientFailure(
  clientPaymentIds: string[], nextAttemptAt: string, error: string
): Promise<void> {
  if (clientPaymentIds.length === 0) return;
  const database = await getDb();
  for (const id of clientPaymentIds) {
    await database.execute(
      `UPDATE customer_payments
       SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
           last_error = $2, retry_count = retry_count + 1,
           first_failed_at = COALESCE(first_failed_at, datetime('now'))
       WHERE client_payment_id = $3`,
      [nextAttemptAt, error, id]
    );
  }
}

export async function markPaymentPermanentFailure(clientPaymentId: string, error: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE customer_payments
     SET sync_status = 'failed', error_kind = 'permanent', next_attempt_at = NULL,
         last_error = $1, retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now'))
     WHERE client_payment_id = $2`,
    [error, clientPaymentId]
  );
}

export async function recoverSyncingPayments(nowIso: string): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE customer_payments
     SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
         last_error = COALESCE(last_error, 'Recovered from interrupted sync'),
         retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now'))
     WHERE sync_status = 'syncing'`,
    [nowIso]
  );
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

export async function getUnsyncedPaymentCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM customer_payments
     WHERE sync_status IN ('pending','syncing')
        OR (sync_status = 'failed' AND error_kind = 'transient')`
  );
  return rows[0]?.c ?? 0;
}

// Apply push results: record the server-capped applied_amount + mark synced for synced/duplicate
// ONLY (contract C-6). failed rows are left untouched — the credit-sync engine marks their failure.
export async function applyPaymentResults(results: SyncPaymentResult[]): Promise<void> {
  const database = await getDb();
  for (const r of results) {
    if (r.status === 'synced' || r.status === 'duplicate') {
      await database.execute(
        `UPDATE customer_payments
         SET sync_status = 'synced', applied_amount = $1,
             error_kind = NULL, next_attempt_at = NULL, last_error = NULL,
             synced_at = datetime('now')
         WHERE client_payment_id = $2`,
        [r.applied_amount ?? null, r.client_payment_id]
      );
    }
  }
}

// Combined credit-outbox counts across BOTH tables (contract C-5). credit-sync's refreshCounts
// folds these into the sync badge (unsynced) and the needs-attention total (permanent).
export async function getUnsyncedCreditCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    `SELECT
       (SELECT COUNT(*) FROM customers
          WHERE sync_status IN ('pending','syncing')
             OR (sync_status = 'failed' AND error_kind = 'transient'))
     + (SELECT COUNT(*) FROM customer_payments
          WHERE sync_status IN ('pending','syncing')
             OR (sync_status = 'failed' AND error_kind = 'transient')) AS c`
  );
  return rows[0]?.c ?? 0;
}

export async function getNeedsAttentionCreditCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    `SELECT
       (SELECT COUNT(*) FROM customers
          WHERE sync_status = 'failed' AND error_kind = 'permanent')
     + (SELECT COUNT(*) FROM customer_payments
          WHERE sync_status = 'failed' AND error_kind = 'permanent') AS c`
  );
  return rows[0]?.c ?? 0;
}
```

### Step 8.4 — Run the full cashier DAO suite and see it PASS

```
npx vitest run src/lib/__tests__/db-payment-sync-dao.test.ts src/lib/__tests__/db-sync-dao.test.ts src/lib/__tests__/db-credit-migration.test.ts src/lib/__tests__/db-credit-sale.test.ts src/lib/__tests__/db-customers-dao.test.ts src/lib/__tests__/db-customer-payments-dao.test.ts src/lib/__tests__/db-customer-balance.test.ts src/lib/__tests__/db-customer-reconcile.test.ts src/lib/__tests__/db-customer-sync-dao.test.ts
npx tsc --noEmit
```
Expected: every suite passes; `tsc` exits 0. This confirms the Phase-1 sales suite (`db-sync-dao.test.ts`) is still green after the `insertSale`/`RawSaleRow` widening.

### Step 8.5 — Commit

```
feat(cashier): add payment sync-worker DAOs + applyPaymentResults
```

---

## Done-when

- `003_offline_credit.sql` exists and is registered as `Migration { version: 3 }` in `lib.rs`.
- `createTestDb()` execs `001` + `002` + `003`.
- `db.ts` exports (all additive): types `NewCustomerInput`, `LocalCustomer`, `CustomerWithBalance` (contract C-1), `CustomerFilter`, `NewPaymentInput`, `LocalCustomerPayment`, `LocalLedgerEntry` (contract C-4), `ServerCustomerItem`. The push-result types `SyncCustomerResult`/`SyncPaymentResult` are **NOT** defined here — they are `import type`d from `./api` (contract C-7). Functions: `insertCustomer` (→ `{ clientCustomerId }`, generates id+timestamp, C-2), `getCustomers`, `getCustomerByClientId`, `getCustomersWithLocalBalance` (argument-less → `CustomerWithBalance[]`, C-1), `getCustomerLocalBalance`, `insertCustomerPayment` (→ `{ clientPaymentId }`, generates ids+timestamp, C-3), `getCustomerLedgerLocal`, `upsertServerCustomers`, `reconcileCustomerBalances`, `getSendableCustomers`, `markCustomerSyncing`, `markCustomerSynced`, `markCustomerTransientFailure`, `markCustomerPermanentFailure`, `recoverSyncingCustomers`, `getUnsyncedCustomerCount`, `applyCustomerIdMap`, `getSendablePayments`, `markPaymentSyncing`, `markPaymentSynced`, `markPaymentTransientFailure`, `markPaymentPermanentFailure`, `recoverSyncingPayments`, `getUnsyncedPaymentCount`, `applyPaymentResults`, `getUnsyncedCreditCount` + `getNeedsAttentionCreditCount` (combined counts, C-5).
- `NewSaleInput`/`insertSale` accept optional `customer_client_id` + `initial_payment_method`; non-credit inserts are unchanged; the Phase-1 sales test suite stays green.
- `npx vitest run` (all new suites) and `npx tsc --noEmit` both pass.

## Notes for the consuming plans

- **credit-sync** owns `SyncCustomerResult`/`SyncPaymentResult` (+`SyncPaymentWarning`) in `api.ts` (contract C-7); this plan `import type`s them. It drives the ordered pass (customers → sales → payments → pull): use `getSendableCustomers`/`markCustomerSyncing`/`applyCustomerIdMap`, then `getSendableSales` (credit sales are ordinary rows), then `getSendablePayments`/`markPaymentSyncing`/`applyPaymentResults`, then `upsertServerCustomers` + `reconcileCustomerBalances` on the bootstrap pull. Per contract C-6 the engine classifies each result and calls `markCustomer{Transient,Permanent}Failure` / `markPayment{Transient,Permanent}Failure` for `failed`/throw cases itself (the `apply*` DAOs only handle `synced`/`duplicate`). Fold `getUnsyncedCreditCount` into the sync badge and `getNeedsAttentionCreditCount` into the needs-attention total (contract C-5).
- **credit-pos** calls `getCustomersWithLocalBalance()` (argument-less; picker), `insertCustomer({ name, phone? … })` (quick-create → `{ clientCustomerId }`), and `insertSale` with `payment_method:'credit'` + `customer_client_id` + `paid_amount` + `initial_payment_method`.
- **customers-ui** calls `getCustomersWithLocalBalance()` (list + debt tabs — filters/searches the returned `CustomerWithBalance[]` client-side), `getCustomerLocalBalance` + `getCustomerLedgerLocal` (detail; `LocalLedgerEntry.amount` is SIGNED, `applied_amount` drives the "переплата не применена" note), and `insertCustomerPayment({ customer_client_id, amount, payment_method, description? })` (accept-payment action, disabled when local debt ≤ 0).
