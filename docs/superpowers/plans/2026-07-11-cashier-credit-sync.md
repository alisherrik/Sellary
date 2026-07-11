# Cashier Credit Sync Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Extend the Phase-1 cashier sync layer so offline **customers**, offline **credit sales**, and offline **debt payments** push to the backend in one ordered pass, with the customer id-map applied before dependent pushes, cap-to-balance/oversell warnings surfaced, and unsynced/needs-attention counts covering all three queues.

**Architecture:** Local-first outbox + single-flight sync engine (Phase 1). This plan is the **transport + orchestration** slice only: the API client (`api.ts`), the pure push/pull helpers (`sync-service.ts`), and the pass sequencer (`sync-engine.ts`). All local SQLite schema, DAOs, and result-application writes are owned by the **data-model** plan and consumed here through typed imports from `./db`.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), Vitest, Zustand, `react-hot-toast`. Tests run on Node 24 via `npx vitest run`; typecheck gate `npx tsc --noEmit`. No native SQLite in these tests — every DB dependency is mocked.

**Depends on:**
- **backend-credit** — ships `POST /api/sync/customers`, `POST /api/sync/payments`, `SyncSaleCreate.{client_customer_id,initial_payment_method}`, and `SyncBootstrapResponse.customers[]` (SPEC §3 C2–C5). This plan calls those endpoints.
- **data-model** — ships local migration `003_offline_credit.sql`, the `customers`/`customer_payments` tables, the extra `sales.customer_client_id`/`sales.initial_payment_method` columns, and the DAO surface listed under **Interface contract from data-model** below (SPEC §5.4). This plan imports those symbols.

---

## Interface contract from data-model (imported from `./db`)

This plan treats the following as already implemented by the data-model plan. If a name here disagrees with the merged data-model plan, reconcile to the data-model plan's name before coding.

**Types**
- `LocalCustomer` — row of the `customers` table (SPEC §2.1). Fields used here: `client_customer_id: string`, `server_id: number | null`, `name: string`, `phone: string | null`, `email: string | null`, `address: string | null`, `description: string | null`, `retry_count: number`.
- `LocalCustomerPayment` — row of the `customer_payments` table (SPEC §2.2). Fields used here: `client_payment_id: string`, `idempotency_key: string`, `customer_client_id: string`, `amount: number`, `payment_method: string`, `description: string | null`, `retry_count: number`.
- `LocalSale` / `SaleWithItems` — extended with `customer_client_id: string | null` and `initial_payment_method: string | null` (SPEC §2.3).

**Sync-worker DAOs**
- `getSendableCustomers(nowIso: string, opts?: { includePermanent?: boolean }): Promise<LocalCustomer[]>`
- `getSendablePayments(nowIso: string, opts?: { includePermanent?: boolean }): Promise<LocalCustomerPayment[]>`
- `markCustomerSyncing(clientCustomerId: string): Promise<void>`
- `markPaymentSyncing(clientPaymentId: string): Promise<void>`
- `applyCustomerIdMap(results: SyncCustomerResult[]): Promise<void>` — handles **ONLY** `synced`/`duplicate` results: set `customers.server_id` + `sync_status='synced'`. It does **NOT** touch `failed` — the sync engine owns failed marking (contract §C-6, mirroring the Phase-1 sales worker).
- `applyPaymentResults(results: SyncPaymentResult[]): Promise<void>` — handles **ONLY** `synced`/`duplicate` results: set `applied_amount` + `sync_status='synced'`. It does **NOT** touch `failed` — the sync engine owns failed marking (contract §C-6).
- `markCustomerPermanentFailure(clientCustomerId: string, error: string): Promise<void>` — the engine calls this per `failed` (server business error) customer result.
- `markPaymentPermanentFailure(clientPaymentId: string, error: string): Promise<void>` — the engine calls this per `failed` (server business error) payment result.
- `markCustomerTransientFailure(clientCustomerIds: string[], nextAttemptAt: string, error: string): Promise<void>` — the engine calls this on a transport throw / non-2xx for the whole batch (backoff).
- `markPaymentTransientFailure(clientPaymentIds: string[], nextAttemptAt: string, error: string): Promise<void>` — the engine calls this on a transport throw / non-2xx for the whole batch (backoff).
- `recoverSyncingCustomers(nowIso: string): Promise<number>`
- `recoverSyncingPayments(nowIso: string): Promise<number>`
- `reconcileCustomerBalances(serverCustomers: SyncBootstrapCustomer[]): Promise<void>` — writes RAW `customers.balance = server_balance` per pulled customer (no pre-subtraction; read-time derivation is the sole subtractor, SPEC §4).
- `getUnsyncedCreditCount(): Promise<number>` — pending + syncing + transient-failed across `customers` **and** `customer_payments`.
- `getNeedsAttentionCreditCount(): Promise<number>` — permanent + unacknowledged across `customers` **and** `customer_payments`.

> `getUnsyncedCount()` / `getNeedsAttentionCount()` (existing) stay **sales-only**. This plan sums them with the two `*CreditCount()` DAOs in `refreshCounts`, so there is no double counting.

`SyncCustomerResult`, `SyncPaymentResult`, `SyncPaymentWarning`, and `SyncBootstrapCustomer` are defined **solely** in `api.ts` by this plan (contract §C-7) with the exact optional/`| null` shapes below; data-model imports them from `../api` (type-only) and accepts them as-is (no redefinition). Acyclic: `api.ts` imports nothing from `db.ts`.

---

## File Structure

- **Modify** `sellary-cashier/src/lib/api.ts` — add `SyncCustomer`/`SyncCustomerResult`/`SyncCustomersResponse`, `SyncPayment`/`SyncPaymentWarning`/`SyncPaymentResult`/`SyncPaymentsResponse`, `SyncBootstrapCustomer`; add `customers` to `SyncBootstrapResponse`; add `client_customer_id`/`initial_payment_method` to `SyncSale`; add `pushCustomers` + `pushPayments`. Per contract §C-8, the `pushPayments` and `fetchBootstrap` response parsers **coerce backend Decimal JSON-strings to `number`** (`Number(...)`) for the new numeric fields (`SyncPaymentResult.applied_amount`, `SyncPaymentWarning.requested`/`applied`, bootstrap customer `balance`).
- **Create** `sellary-cashier/src/lib/__tests__/sync-api.test.ts` — fetch-mocked tests for `pushCustomers` + `pushPayments` (endpoint, body, bearer, result parsing).
- **Modify** `sellary-cashier/src/lib/sync-service.ts` — add `pushCustomersOnce`/`pushPaymentsOnce`; add credit fields to `pushOnce`; reconcile customers in `pullCatalog`.
- **Modify** `sellary-cashier/src/lib/__tests__/sync-service.test.ts` — cover the new helpers + updated `pushOnce`/`pullCatalog`.
- **Modify** `sellary-cashier/src/lib/sync-engine.ts` — `runCreditQueue` helper + customer/payment ops; sequence `runPass` as customers → sales → payments → pull; the engine reconcile **owns failed-result marking** (contract §C-6): `synced`/`duplicate` → `applyCustomerIdMap`/`applyPaymentResults`; per-result `status==='failed'` → `markCustomerPermanentFailure`/`markPaymentPermanentFailure`; transport throw / non-2xx → `markCustomerTransientFailure`/`markPaymentTransientFailure` (backoff). Aggregate warnings + counts.
- **Modify** `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` — ordering, id-map-before-sales, warning surfacing, per-queue backoff, force-includePermanent, combined counts.

`sync-store.ts` is **unchanged** — `unsyncedCount`, `needsAttentionCount`, and `lastWarningCount` already exist; this plan only changes what the engine writes into them.

---

## Task 1: Credit sync API client (`api.ts`)

**Files:**
- `sellary-cashier/src/lib/api.ts` (modify)
- `sellary-cashier/src/lib/__tests__/sync-api.test.ts` (create)

### Step 1.1 — Write the failing test

Create `sellary-cashier/src/lib/__tests__/sync-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushCustomers, pushPayments, fetchBootstrap, setApiBaseUrl, setAccessToken } from '../api';

describe('sync credit api', () => {
  beforeEach(async () => {
    await setApiBaseUrl('http://127.0.0.1:8001');
    setAccessToken('bearer-xyz');
    vi.restoreAllMocks();
  });

  it('pushCustomers POSTs { customers } to /api/sync/customers with the bearer and parses results', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [{ client_customer_id: 'c1', status: 'synced', server_id: 55 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await pushCustomers([
      { client_customer_id: 'c1', name: 'Иван', phone: null, email: null, address: null, description: null },
    ]);

    expect(res.results[0]).toEqual({ client_customer_id: 'c1', status: 'synced', server_id: 55 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/sync/customers');
    expect(JSON.parse(init.body)).toEqual({
      customers: [{ client_customer_id: 'c1', name: 'Иван', phone: null, email: null, address: null, description: null }],
    });
    expect(init.headers.Authorization).toBe('Bearer bearer-xyz');
  });

  it('pushPayments POSTs { payments } to /api/sync/payments and coerces Decimal JSON-strings to numbers', async () => {
    // Contract §C-8: the backend serializes Decimal as JSON strings ("30.00"); api.ts must coerce
    // applied_amount + warning requested/applied to real numbers before the engine sees them.
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        results: [
          {
            client_payment_id: 'p1',
            status: 'synced',
            applied_amount: '30.00',
            warnings: [{ type: 'overpayment', requested: '50.00', applied: '30.00' }],
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await pushPayments([
      { client_payment_id: 'p1', idempotency_key: 'idem-p1', client_customer_id: 'c1', amount: 50, payment_method: 'cash', description: null },
    ]);

    // Coerced: string '30.00' -> number 30 (strict identity, not just deep-equal).
    expect(res.results[0].applied_amount).toBe(30);
    expect(typeof res.results[0].applied_amount).toBe('number');
    expect(res.results[0].warnings?.[0]).toEqual({ type: 'overpayment', requested: 50, applied: 30 });
    expect(typeof res.results[0].warnings?.[0].requested).toBe('number');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/sync/payments');
    expect(JSON.parse(init.body)).toEqual({
      payments: [{ client_payment_id: 'p1', idempotency_key: 'idem-p1', client_customer_id: 'c1', amount: 50, payment_method: 'cash', description: null }],
    });
  });

  it('fetchBootstrap coerces customer balance Decimal JSON-strings to numbers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        company_id: 1,
        company_name: 'Acme',
        user_id: 1,
        user_username: 'u',
        user_role: 'cashier',
        server_time: '2026-07-11T00:00:00.000Z',
        products: [],
        categories: [],
        customers: [
          { id: 1, client_customer_id: 'srv:1', name: 'Иван', phone: null, email: null, address: null, description: null, balance: '30.00', is_active: true },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchBootstrap();

    // Coerced: string '30.00' -> number 30.
    expect(res.customers[0].balance).toBe(30);
    expect(typeof res.customers[0].balance).toBe('number');
  });
});
```

### Step 1.2 — Run and see it FAIL

```
cd sellary-cashier && npx vitest run src/lib/__tests__/sync-api.test.ts
```

Expected: FAIL — `pushCustomers`/`pushPayments` are not exported from `../api` (import resolves to `undefined`, call throws `TypeError: pushCustomers is not a function`).

### Step 1.3 — Minimal implementation

In `sellary-cashier/src/lib/api.ts`, add the new types + functions. Place the type blocks immediately after the existing `SyncSalesResponse` interface (after line 229), and the functions immediately after `pushSales` (after line 240).

Add these interfaces:

```ts
export interface SyncCustomer {
  client_customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
}

export interface SyncCustomerResult {
  client_customer_id: string;
  status: 'synced' | 'duplicate' | 'failed';
  server_id?: number | null;
  error?: string | null;
}

export interface SyncCustomersResponse {
  results: SyncCustomerResult[];
}

export interface SyncPayment {
  client_payment_id: string;
  idempotency_key: string;
  client_customer_id: string;
  amount: number;
  payment_method: string;
  description: string | null;
}

export interface SyncPaymentWarning {
  type: string;
  requested: number;
  applied: number;
}

export interface SyncPaymentResult {
  client_payment_id: string;
  status: 'synced' | 'duplicate' | 'failed';
  applied_amount?: number | null;
  warnings?: SyncPaymentWarning[] | null;
  error?: string | null;
}

export interface SyncPaymentsResponse {
  results: SyncPaymentResult[];
}

export interface SyncBootstrapCustomer {
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
```

Add these functions. `pushCustomers` needs no coercion (`server_id` is a plain integer). `pushPayments` MUST coerce the Decimal-as-string numeric fields to `number` (contract §C-8):

```ts
export async function pushCustomers(customers: SyncCustomer[]): Promise<SyncCustomersResponse> {
  return apiFetch('/api/sync/customers', {
    method: 'POST',
    body: JSON.stringify({ customers }),
  });
}

export async function pushPayments(payments: SyncPayment[]): Promise<SyncPaymentsResponse> {
  const res = await apiFetch<SyncPaymentsResponse>('/api/sync/payments', {
    method: 'POST',
    body: JSON.stringify({ payments }),
  });
  // Contract §C-8: backend serializes Decimal as JSON strings ("30.00"). Coerce the new numeric
  // fields to real numbers so the engine / local-balance math never do string arithmetic.
  return {
    results: res.results.map((r) => ({
      ...r,
      applied_amount: r.applied_amount == null ? r.applied_amount : Number(r.applied_amount),
      warnings:
        r.warnings == null
          ? r.warnings
          : r.warnings.map((w) => ({ ...w, requested: Number(w.requested), applied: Number(w.applied) })),
    })),
  };
}
```

Replace the existing `fetchBootstrap` (currently `return apiFetch('/api/sync/bootstrap');` at lines 231–233) so it coerces each pulled customer's Decimal `balance` string to `number` (contract §C-8):

```ts
export async function fetchBootstrap(): Promise<SyncBootstrapResponse> {
  const res = await apiFetch<SyncBootstrapResponse>('/api/sync/bootstrap');
  // Contract §C-8: customer balance arrives as a Decimal JSON string; coerce to number so
  // reconcileCustomerBalances and read-time balance derivation work with real numbers.
  return {
    ...res,
    customers: (res.customers ?? []).map((c) => ({ ...c, balance: Number(c.balance) })),
  };
}
```

Extend `SyncSale` (existing interface at lines 197–208) with two optional credit fields — add them just before the `items` line:

```ts
export interface SyncSale {
  client_sale_id: string;
  idempotency_key: string;
  created_at_client: string;
  payment_method: string;
  card_type?: string | null;
  discount_amount: number;
  paid_amount: number;
  change_amount: number;
  notes?: string | null;
  client_customer_id?: string | null;
  initial_payment_method?: string | null;
  items: SyncSaleItem[];
}
```

Extend `SyncBootstrapResponse` (existing interface at lines 164–189) — add a `customers` field after the `categories` array:

```ts
  categories: Array<{
    id: number;
    name: string;
    is_active: boolean;
    updated_at: string | null;
  }>;
  customers: SyncBootstrapCustomer[];
}
```

### Step 1.4 — Run and see it PASS

```
cd sellary-cashier && npx vitest run src/lib/__tests__/sync-api.test.ts
```

Expected: PASS (2 passed). Then the typecheck gate:

```
cd sellary-cashier && npx tsc --noEmit
```

Expected: exit 0.

### Step 1.5 — Commit

```
git add sellary-cashier/src/lib/api.ts sellary-cashier/src/lib/__tests__/sync-api.test.ts
git commit -m "feat(cashier): add credit sync api client (pushCustomers/pushPayments + sale credit fields)"
```

---

## Task 2: Pure push/pull helpers (`sync-service.ts`)

**Files:**
- `sellary-cashier/src/lib/sync-service.ts` (modify)
- `sellary-cashier/src/lib/__tests__/sync-service.test.ts` (modify)

### Step 2.1 — Write the failing tests

Edit `sellary-cashier/src/lib/__tests__/sync-service.test.ts`.

First, extend the hoisted mocks and module mocks. Replace the existing `vi.hoisted(...)` block (lines 3–15), the `vi.mock('../api', ...)` block (lines 17–20), and the `vi.mock('../db', ...)` block (lines 24–28) with:

```ts
const {
  mockPushSales,
  mockFetchBootstrap,
  mockPushCustomers,
  mockPushPayments,
  mockUpsertProducts,
  mockUpsertCategories,
  mockSetMeta,
  mockReconcileCustomerBalances,
} = vi.hoisted(() => ({
  mockPushSales: vi.fn(),
  mockFetchBootstrap: vi.fn(),
  mockPushCustomers: vi.fn(),
  mockPushPayments: vi.fn(),
  mockUpsertProducts: vi.fn(),
  mockUpsertCategories: vi.fn(),
  mockSetMeta: vi.fn(),
  mockReconcileCustomerBalances: vi.fn(),
}));

vi.mock('../api', () => ({
  pushSales: mockPushSales,
  fetchBootstrap: mockFetchBootstrap,
  pushCustomers: mockPushCustomers,
  pushPayments: mockPushPayments,
}));

// Per contract §4.1, sync-service does NOT import getUnsyncedBaseQtyByProduct —
// upsertProducts (data-model) is the sole stock subtractor. pullCatalog only forwards raw products.
vi.mock('../db', () => ({
  upsertProducts: mockUpsertProducts,
  upsertCategories: mockUpsertCategories,
  setMeta: mockSetMeta,
  reconcileCustomerBalances: mockReconcileCustomerBalances,
}));
```

Update the import line (line 30) to pull in the new helpers:

```ts
import { pushOnce, pullCatalog, pushCustomersOnce, pushPaymentsOnce } from '../sync-service';
```

Add two factory helpers after `makeServerProduct` (after line 64):

```ts
function makeCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    client_customer_id: 'c1',
    server_id: null,
    name: 'Иван',
    phone: '+998901234567',
    email: null,
    address: null,
    description: null,
    retry_count: 0,
    ...overrides,
  } as never;
}

function makePayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    client_payment_id: 'p1',
    idempotency_key: 'idem-p1',
    customer_client_id: 'c1',
    amount: 50,
    payment_method: 'cash',
    description: null,
    retry_count: 0,
    ...overrides,
  } as never;
}
```

Add the new defaults to `beforeEach` (inside the block at lines 66–71, after `mockSetMeta.mockResolvedValue(undefined);`):

```ts
  mockReconcileCustomerBalances.mockResolvedValue(undefined);
```

Update the existing `pushOnce` payload assertion (lines 83–96) to include the two new credit fields (both `null` for a cash sale):

```ts
    expect(payload).toEqual([
      {
        client_sale_id: 'sale-1',
        idempotency_key: 'idem-1',
        created_at_client: '2026-07-10T00:00:00.000Z',
        payment_method: 'cash',
        card_type: null,
        discount_amount: 0,
        paid_amount: 100,
        change_amount: 0,
        notes: null,
        client_customer_id: null,
        initial_payment_method: null,
        items: [{ product_id: 7, quantity: 3, sell_price: 50 }],
      },
    ]);
```

Update the existing `pullCatalog` result assertion (line 117) to include the customers count and give the mocked bootstrap a `customers: []` (edit the `mockFetchBootstrap.mockResolvedValue` at lines 104–108 to add `customers: []`, and change the `res` assertion):

```ts
    mockFetchBootstrap.mockResolvedValue({
      server_time: '2026-07-10T01:00:00.000Z',
      products: [makeServerProduct({ id: 7, stock_quantity: 100 })],
      categories: [{ id: 1, name: 'Drinks', is_active: true, updated_at: null }],
      customers: [],
    });
```

```ts
    expect(res).toEqual({ products: 1, categories: 1, customers: 0 });
```

Now append three new describe blocks at the end of the file (after line 133):

```ts
describe('pushCustomersOnce', () => {
  it('maps LocalCustomer[] to the SyncCustomer payload and returns server results', async () => {
    mockPushCustomers.mockResolvedValue({
      results: [{ client_customer_id: 'c1', status: 'synced', server_id: 55 }],
    });

    const results = await pushCustomersOnce([makeCustomer()]);

    expect(mockPushCustomers).toHaveBeenCalledTimes(1);
    expect(mockPushCustomers.mock.calls[0][0]).toEqual([
      { client_customer_id: 'c1', name: 'Иван', phone: '+998901234567', email: null, address: null, description: null },
    ]);
    expect(results[0].server_id).toBe(55);
  });
});

describe('pushPaymentsOnce', () => {
  it('maps LocalCustomerPayment[] (customer_client_id -> client_customer_id) and returns results', async () => {
    mockPushPayments.mockResolvedValue({
      results: [{ client_payment_id: 'p1', status: 'synced', applied_amount: 30, warnings: null }],
    });

    const results = await pushPaymentsOnce([makePayment()]);

    expect(mockPushPayments).toHaveBeenCalledTimes(1);
    expect(mockPushPayments.mock.calls[0][0]).toEqual([
      { client_payment_id: 'p1', idempotency_key: 'idem-p1', client_customer_id: 'c1', amount: 50, payment_method: 'cash', description: null },
    ]);
    expect(results[0].applied_amount).toBe(30);
  });
});

describe('pushOnce credit fields', () => {
  it('forwards customer_client_id + initial_payment_method for a credit sale', async () => {
    mockPushSales.mockResolvedValue({
      results: [{ client_sale_id: 'sale-1', status: 'synced', sale_id: 900, warnings: null, error: null }],
    });

    await pushOnce([makeSale({ payment_method: 'credit', customer_client_id: 'c1', initial_payment_method: 'cash', paid_amount: 20 })]);

    const payload = mockPushSales.mock.calls[0][0];
    expect(payload[0].payment_method).toBe('credit');
    expect(payload[0].client_customer_id).toBe('c1');
    expect(payload[0].initial_payment_method).toBe('cash');
  });
});

describe('pullCatalog reconciles customers (raw server balances)', () => {
  it('forwards bootstrap.customers to reconcileCustomerBalances and counts them', async () => {
    mockFetchBootstrap.mockResolvedValue({
      server_time: '2026-07-10T01:00:00.000Z',
      products: [],
      categories: [],
      customers: [
        { id: 1, client_customer_id: 'srv:1', name: 'Иван', phone: null, email: null, address: null, description: null, balance: 120, is_active: true },
      ],
    });

    const res = await pullCatalog();

    expect(mockReconcileCustomerBalances).toHaveBeenCalledTimes(1);
    const forwarded = mockReconcileCustomerBalances.mock.calls[0][0];
    expect(forwarded[0].balance).toBe(120); // RAW server balance, not pre-subtracted
    expect(res.customers).toBe(1);
  });
});
```

### Step 2.2 — Run and see it FAIL

```
cd sellary-cashier && npx vitest run src/lib/__tests__/sync-service.test.ts
```

Expected: FAIL — `pushCustomersOnce`/`pushPaymentsOnce` are not exported (import `undefined`), the `pushOnce` payload assertion misses `client_customer_id`/`initial_payment_method`, and `res` lacks `customers`.

### Step 2.3 — Minimal implementation

Rewrite `sellary-cashier/src/lib/sync-service.ts` in full:

```ts
import { fetchBootstrap, pushSales, pushCustomers, pushPayments } from './api';
import type {
  SyncSale,
  SyncSaleResult,
  SyncCustomer,
  SyncCustomerResult,
  SyncPayment,
  SyncPaymentResult,
} from './api';
import { upsertProducts, upsertCategories, setMeta, reconcileCustomerBalances } from './db';
import type { SaleWithItems, LocalCustomer, LocalCustomerPayment } from './db';

/**
 * Build the SyncSale payload deterministically from structured columns and push it.
 * Pure + mutex-free: the engine owns the single-flight lock and all state writes.
 * Credit sales carry customer_client_id + initial_payment_method; non-credit sales send null.
 */
export async function pushOnce(sendable: SaleWithItems[]): Promise<SyncSaleResult[]> {
  const payload: SyncSale[] = sendable.map((s) => ({
    client_sale_id: s.client_sale_id,
    idempotency_key: s.idempotency_key,
    created_at_client: s.created_at_client,
    payment_method: s.payment_method,
    card_type: s.card_type ?? null,
    discount_amount: s.discount_amount ?? 0,
    paid_amount: s.paid_amount ?? 0,
    change_amount: s.change_amount ?? 0,
    notes: s.notes ?? null,
    client_customer_id: s.customer_client_id ?? null,
    initial_payment_method: s.initial_payment_method ?? null,
    items: s.items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity, // base units
      sell_price: it.unit_price,
    })),
  }));
  const res = await pushSales(payload);
  return res.results;
}

/**
 * Push offline-created customers. The engine applies {client_customer_id -> server_id}
 * (applyCustomerIdMap) to local rows BEFORE credit sales/payments are pushed, so the
 * server can resolve customer references in the same pass.
 */
export async function pushCustomersOnce(sendable: LocalCustomer[]): Promise<SyncCustomerResult[]> {
  const payload: SyncCustomer[] = sendable.map((c) => ({
    client_customer_id: c.client_customer_id,
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    address: c.address ?? null,
    description: c.description ?? null,
  }));
  const res = await pushCustomers(payload);
  return res.results;
}

/**
 * Push queued debt payments. The server caps each to the current balance and returns
 * applied_amount (+ an overpayment warning when capped); the engine surfaces those warnings.
 */
export async function pushPaymentsOnce(sendable: LocalCustomerPayment[]): Promise<SyncPaymentResult[]> {
  const payload: SyncPayment[] = sendable.map((p) => ({
    client_payment_id: p.client_payment_id,
    idempotency_key: p.idempotency_key,
    client_customer_id: p.customer_client_id,
    amount: p.amount,
    payment_method: p.payment_method,
    description: p.description ?? null,
  }));
  const res = await pushPayments(payload);
  return res.results;
}

/**
 * Full-refresh catalog pull (spec §5.2). Per contract §4.1, stock reconciliation
 *   local_stock(p) = server_stock(p) - Σ base_qty(p) over sales sync_status ∈ {pending,syncing,failed}
 * lives ENTIRELY inside `upsertProducts` (the sole subtractor). pullCatalog MUST forward the
 * RAW server snapshot — pre-subtracting here would double-count.
 *
 * Debt balances follow the same rule (spec §4): reconcileCustomerBalances writes the RAW
 * server balance; the local unsynced credit/payment delta is applied at read time only.
 */
export async function pullCatalog(): Promise<{ products: number; categories: number; customers: number }> {
  const bootstrap = await fetchBootstrap();
  await upsertCategories(bootstrap.categories);
  await upsertProducts(bootstrap.products); // RAW products — upsertProducts subtracts unsynced qty
  const customers = bootstrap.customers ?? [];
  await reconcileCustomerBalances(customers); // RAW balances — read-time derivation subtracts
  await setMeta('last_catalog_pull_at', bootstrap.server_time);
  return { products: bootstrap.products.length, categories: bootstrap.categories.length, customers: customers.length };
}
```

### Step 2.4 — Run and see it PASS

```
cd sellary-cashier && npx vitest run src/lib/__tests__/sync-service.test.ts
```

Expected: PASS (all describe blocks green). Then typecheck:

```
cd sellary-cashier && npx tsc --noEmit
```

Expected: exit 0.

### Step 2.5 — Commit

```
git add sellary-cashier/src/lib/sync-service.ts sellary-cashier/src/lib/__tests__/sync-service.test.ts
git commit -m "feat(cashier): pushCustomersOnce/pushPaymentsOnce helpers + customer reconcile in pullCatalog"
```

---

## Task 3: Ordered credit pass in the sync engine (`sync-engine.ts`)

**Files:**
- `sellary-cashier/src/lib/sync-engine.ts` (modify)
- `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (modify)

### Step 3.1 — Write the failing tests

Edit `sellary-cashier/src/lib/__tests__/sync-engine.test.ts`.

Extend the hoisted mocks. Add these fields to the `vi.hoisted(...)` object (both the destructure and the returned object, lines 3–37) — insert after `mockAddSyncEvent`:

```ts
  mockPushCustomersOnce: vi.fn(),
  mockPushPaymentsOnce: vi.fn(),
  mockGetSendableCustomers: vi.fn(),
  mockMarkCustomerSyncing: vi.fn(),
  mockApplyCustomerIdMap: vi.fn(),
  mockMarkCustomerPermanentFailure: vi.fn(),
  mockMarkCustomerTransientFailure: vi.fn(),
  mockRecoverSyncingCustomers: vi.fn(),
  mockGetSendablePayments: vi.fn(),
  mockMarkPaymentSyncing: vi.fn(),
  mockApplyPaymentResults: vi.fn(),
  mockMarkPaymentPermanentFailure: vi.fn(),
  mockMarkPaymentTransientFailure: vi.fn(),
  mockRecoverSyncingPayments: vi.fn(),
  mockGetUnsyncedCreditCount: vi.fn(),
  mockGetNeedsAttentionCreditCount: vi.fn(),
```

Update the `vi.mock('../sync-service', ...)` line (line 40):

```ts
vi.mock('../sync-service', () => ({
  pushOnce: mockPushOnce,
  pullCatalog: mockPullCatalog,
  pushCustomersOnce: mockPushCustomersOnce,
  pushPaymentsOnce: mockPushPaymentsOnce,
}));
```

Update the `vi.mock('../db', ...)` block (lines 46–58) to add the new DAOs:

```ts
vi.mock('../db', () => ({
  getSendableSales: mockGetSendableSales,
  markSaleSyncing: mockMarkSaleSyncing,
  markSaleSynced: mockMarkSaleSynced,
  markTransientFailure: mockMarkTransientFailure,
  markPermanentFailure: mockMarkPermanentFailure,
  recoverSyncingSales: mockRecoverSyncingSales,
  getUnsyncedCount: mockGetUnsyncedCount,
  getNeedsAttentionCount: mockGetNeedsAttentionCount,
  getMeta: mockGetMeta,
  setMeta: mockSetMeta,
  addSyncEvent: mockAddSyncEvent,
  getSendableCustomers: mockGetSendableCustomers,
  markCustomerSyncing: mockMarkCustomerSyncing,
  applyCustomerIdMap: mockApplyCustomerIdMap,
  markCustomerPermanentFailure: mockMarkCustomerPermanentFailure,
  markCustomerTransientFailure: mockMarkCustomerTransientFailure,
  recoverSyncingCustomers: mockRecoverSyncingCustomers,
  getSendablePayments: mockGetSendablePayments,
  markPaymentSyncing: mockMarkPaymentSyncing,
  applyPaymentResults: mockApplyPaymentResults,
  markPaymentPermanentFailure: mockMarkPaymentPermanentFailure,
  markPaymentTransientFailure: mockMarkPaymentTransientFailure,
  recoverSyncingPayments: mockRecoverSyncingPayments,
  getUnsyncedCreditCount: mockGetUnsyncedCreditCount,
  getNeedsAttentionCreditCount: mockGetNeedsAttentionCreditCount,
}));
```

Add two factory helpers after `makeSale` (after line 86):

```ts
function makeCustomer(clientId: string, retry = 0) {
  return {
    client_customer_id: clientId,
    server_id: null,
    name: 'Иван',
    phone: '+998901234567',
    email: null,
    address: null,
    description: null,
    retry_count: retry,
  } as never;
}

function makePayment(clientId: string, retry = 0) {
  return {
    client_payment_id: clientId,
    idempotency_key: `idem-${clientId}`,
    customer_client_id: 'c1',
    amount: 50,
    payment_method: 'cash',
    description: null,
    retry_count: retry,
  } as never;
}
```

Add the new defaults to `beforeEach` (after the existing `mockMarkPermanentFailure.mockResolvedValue(undefined);` line, line 104):

```ts
  mockPushCustomersOnce.mockResolvedValue([]);
  mockPushPaymentsOnce.mockResolvedValue([]);
  mockGetSendableCustomers.mockResolvedValue([]);
  mockMarkCustomerSyncing.mockResolvedValue(undefined);
  mockApplyCustomerIdMap.mockResolvedValue(undefined);
  mockMarkCustomerPermanentFailure.mockResolvedValue(undefined);
  mockMarkCustomerTransientFailure.mockResolvedValue(undefined);
  mockRecoverSyncingCustomers.mockResolvedValue(0);
  mockGetSendablePayments.mockResolvedValue([]);
  mockMarkPaymentSyncing.mockResolvedValue(undefined);
  mockApplyPaymentResults.mockResolvedValue(undefined);
  mockMarkPaymentPermanentFailure.mockResolvedValue(undefined);
  mockMarkPaymentTransientFailure.mockResolvedValue(undefined);
  mockRecoverSyncingPayments.mockResolvedValue(0);
  mockGetUnsyncedCreditCount.mockResolvedValue(0);
  mockGetNeedsAttentionCreditCount.mockResolvedValue(0);
```

Append a new describe block at the end of the file (after line 399):

```ts
describe('ordered credit pass', () => {
  it('pushes customers before sales and payments, applying the id-map before the sales push', async () => {
    mockGetSendableCustomers.mockResolvedValue([makeCustomer('c1')]);
    mockPushCustomersOnce.mockResolvedValue([{ client_customer_id: 'c1', status: 'synced', server_id: 55 }]);
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
    mockPushOnce.mockResolvedValue([{ client_sale_id: 'a', status: 'synced', sale_id: 900, warnings: null, error: null }]);
    mockGetSendablePayments.mockResolvedValue([makePayment('p1')]);
    mockPushPaymentsOnce.mockResolvedValue([{ client_payment_id: 'p1', status: 'synced', applied_amount: 50, warnings: null, error: null }]);

    const res = await requestSync('manual');

    // Ordering: customers -> sales -> payments (global invocation order).
    const custOrder = mockPushCustomersOnce.mock.invocationCallOrder[0];
    const salesOrder = mockPushOnce.mock.invocationCallOrder[0];
    const payOrder = mockPushPaymentsOnce.mock.invocationCallOrder[0];
    expect(custOrder).toBeLessThan(salesOrder);
    expect(salesOrder).toBeLessThan(payOrder);

    // Id-map applied before the sales push, so credit sales resolve server_id in the same pass.
    expect(mockApplyCustomerIdMap).toHaveBeenCalledWith([{ client_customer_id: 'c1', status: 'synced', server_id: 55 }]);
    expect(mockApplyCustomerIdMap.mock.invocationCallOrder[0]).toBeLessThan(salesOrder);
    expect(mockApplyPaymentResults).toHaveBeenCalledWith([{ client_payment_id: 'p1', status: 'synced', applied_amount: 50, warnings: null, error: null }]);
    expect(res.synced).toBe(3);
  });

  it('surfaces payment overpayment warnings as an amber toast and adds them to lastWarningCount', async () => {
    mockGetSendablePayments.mockResolvedValue([makePayment('p1')]);
    mockPushPaymentsOnce.mockResolvedValue([
      { client_payment_id: 'p1', status: 'synced', applied_amount: 30, warnings: [{ type: 'overpayment', requested: 50, applied: 30 }], error: null },
    ]);

    await requestSync('manual');

    expect(mockApplyPaymentResults).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().lastWarningCount).toBe(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('Оплата превышает долг'),
      expect.objectContaining({ icon: '⚠️' }),
    );
  });

  it('marks a failed (business-error) customer/payment result permanent — apply* is not the marker (contract §C-6)', async () => {
    mockGetSendableCustomers.mockResolvedValue([makeCustomer('c1')]);
    mockPushCustomersOnce.mockResolvedValue([
      { client_customer_id: 'c1', status: 'failed', server_id: null, error: 'duplicate phone' },
    ]);
    mockGetSendablePayments.mockResolvedValue([makePayment('p1')]);
    mockPushPaymentsOnce.mockResolvedValue([
      { client_payment_id: 'p1', status: 'failed', applied_amount: null, warnings: null, error: 'customer not found' },
    ]);

    const res = await requestSync('manual');

    // The engine — not applyCustomerIdMap/applyPaymentResults — marks the failed rows permanent.
    expect(mockMarkCustomerPermanentFailure).toHaveBeenCalledWith('c1', 'duplicate phone');
    expect(mockMarkPaymentPermanentFailure).toHaveBeenCalledWith('p1', 'customer not found');
    // apply* still runs (it internally ignores the failed rows), but does no failed marking itself.
    expect(mockApplyCustomerIdMap).toHaveBeenCalledTimes(1);
    expect(mockApplyPaymentResults).toHaveBeenCalledTimes(1);
    expect(res.permanentFailed).toBe(2);
    expect(res.transientFailed).toBe(0);
  });

  it('classifies a customer-queue transport throw as transient and skips the sales + payment pushes', async () => {
    mockGetSendableCustomers.mockResolvedValue([makeCustomer('c1', 0)]);
    mockPushCustomersOnce.mockRejectedValue(new Error('Network failure'));

    const res = await requestSync('manual');

    expect(mockMarkCustomerTransientFailure).toHaveBeenCalledTimes(1);
    const [ids, nextAttemptAt, error] = mockMarkCustomerTransientFailure.mock.calls[0];
    expect(ids).toEqual(['c1']);
    expect(new Date(nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(error).toBe('Network failure');
    expect(mockPushOnce).not.toHaveBeenCalled();
    expect(mockPushPaymentsOnce).not.toHaveBeenCalled();
    expect(res.transientFailed).toBe(1);
    expect(useSyncStore.getState().engineState).toBe('backing_off');
    expect(useSyncStore.getState().lastError).toBe('Network failure');
  });

  it('classifies a payment-queue transport throw as transient with a backoff schedule', async () => {
    mockGetSendablePayments.mockResolvedValue([makePayment('p1', 2)]);
    mockPushPaymentsOnce.mockRejectedValue(new Error('Boom'));

    const res = await requestSync('manual');

    expect(mockMarkPaymentTransientFailure).toHaveBeenCalledTimes(1);
    const [ids, nextAttemptAt, error] = mockMarkPaymentTransientFailure.mock.calls[0];
    expect(ids).toEqual(['p1']);
    expect(new Date(nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(error).toBe('Boom');
    expect(res.transientFailed).toBe(1);
    expect(useSyncStore.getState().engineState).toBe('backing_off');
  });

  it('force:true requests sendable customers and payments including permanent-failed rows', async () => {
    await requestSync('manual', { force: true });

    expect(mockGetSendableCustomers).toHaveBeenCalledWith(expect.any(String), { includePermanent: true });
    expect(mockGetSendablePayments).toHaveBeenCalledWith(expect.any(String), { includePermanent: true });
  });

  it('unsyncedCount and needsAttentionCount aggregate sales + customers + payments', async () => {
    mockGetUnsyncedCount.mockResolvedValue(3);
    mockGetNeedsAttentionCount.mockResolvedValue(1);
    mockGetUnsyncedCreditCount.mockResolvedValue(4);
    mockGetNeedsAttentionCreditCount.mockResolvedValue(2);

    await requestSync('manual');

    expect(useSyncStore.getState().unsyncedCount).toBe(7);
    expect(useSyncStore.getState().needsAttentionCount).toBe(3);
  });
});
```

### Step 3.2 — Run and see it FAIL

```
cd sellary-cashier && npx vitest run src/lib/__tests__/sync-engine.test.ts
```

Expected: FAIL — the engine never calls `pushCustomersOnce`/`pushPaymentsOnce`/`applyCustomerIdMap`/etc., so ordering, id-map, warning, backoff, force, and count assertions all fail (e.g. `mockPushCustomersOnce.mock.invocationCallOrder[0]` is `undefined`; `lastWarningCount` stays 0; `unsyncedCount` stays 0).

### Step 3.3 — Minimal implementation

Edit `sellary-cashier/src/lib/sync-engine.ts`.

**(a)** Replace the imports (lines 2–17) with:

```ts
import { pushOnce, pullCatalog, pushCustomersOnce, pushPaymentsOnce } from './sync-service';
import {
  getSendableSales,
  markSaleSyncing,
  markSaleSynced,
  markTransientFailure,
  markPermanentFailure,
  recoverSyncingSales,
  getUnsyncedCount,
  getNeedsAttentionCount,
  getMeta,
  setMeta,
  addSyncEvent,
  getSendableCustomers,
  markCustomerSyncing,
  applyCustomerIdMap,
  markCustomerPermanentFailure,
  markCustomerTransientFailure,
  recoverSyncingCustomers,
  getSendablePayments,
  markPaymentSyncing,
  applyPaymentResults,
  markPaymentPermanentFailure,
  markPaymentTransientFailure,
  recoverSyncingPayments,
  getUnsyncedCreditCount,
  getNeedsAttentionCreditCount,
} from './db';
import type { LocalCustomer, LocalCustomerPayment } from './db';
import type { SyncCustomerResult, SyncPaymentResult } from './api';
```

Keep the existing `import { checkHealth } from './api';` (line 1), the `useSyncStore` import (line 16), the `getErrorMessage` import (line 17), and the `toast` import (line 18) as-is.

**(b)** Replace `refreshCounts` (lines 68–77) with the aggregating version:

```ts
async function refreshCounts(): Promise<void> {
  const [salesUnsynced, salesAttention, creditUnsynced, creditAttention] = await Promise.all([
    getUnsyncedCount(),
    getNeedsAttentionCount(),
    getUnsyncedCreditCount(),
    getNeedsAttentionCreditCount(),
  ]);
  useSyncStore.getState().patch({
    unsyncedCount: salesUnsynced + creditUnsynced,
    needsAttentionCount: salesAttention + creditAttention,
  });
}
```

**(c)** Add the generic credit-queue helper + ops. Insert this block immediately after `maybeRefreshCatalog` (after line 87, before the `// --- single-flight + coalescing ---` comment):

```ts
// --- generic credit-queue push (customers + payments share the reconcile/backoff shape) ---
interface CreditQueueOutcome {
  synced: number;
  permanentFailed: number;
  transientFailed: number;
  warnings: number;
  transportError: string | null;
  maxRetry: number;
}

const EMPTY_QUEUE_OUTCOME: CreditQueueOutcome = {
  synced: 0,
  permanentFailed: 0,
  transientFailed: 0,
  warnings: 0,
  transportError: null,
  maxRetry: 0,
};

interface CreditQueueOps<TItem, TResult> {
  getSendable: (nowIso: string, opts?: { includePermanent?: boolean }) => Promise<TItem[]>;
  clientKey: (item: TItem) => string;
  retryCount: (item: TItem) => number;
  markSyncing: (clientKey: string) => Promise<void>;
  push: (items: TItem[]) => Promise<TResult[]>;
  apply: (results: TResult[]) => Promise<void>; // synced/duplicate ONLY (contract §C-6)
  resultKey: (result: TResult) => string;
  isSynced: (result: TResult) => boolean;
  warningsOf: (result: TResult) => number;
  errorOf: (result: TResult) => string;
  markPermanent: (clientKey: string, error: string) => Promise<void>; // per failed business result
  markTransient: (clientKeys: string[], nextAttemptAt: string, error: string) => Promise<void>;
}

// Mirrors the Phase-1 sales worker: mark syncing, push, then the ENGINE reconciles results —
// apply() writes synced/duplicate rows; failed (business) results are marked permanent here;
// a transport throw / non-2xx backs off the whole batch (contract §C-6). apply() never marks failed.
async function runCreditQueue<TItem, TResult>(
  ops: CreditQueueOps<TItem, TResult>,
  now: string,
  force: boolean,
): Promise<CreditQueueOutcome> {
  const sendable = await ops.getSendable(now, force ? { includePermanent: true } : undefined);
  if (sendable.length === 0) return EMPTY_QUEUE_OUTCOME;
  for (const item of sendable) {
    await ops.markSyncing(ops.clientKey(item));
  }
  try {
    const results = await ops.push(sendable);
    await ops.apply(results); // synced/duplicate ONLY — engine owns failed marking below
    let synced = 0;
    let permanentFailed = 0;
    let warnings = 0;
    for (const r of results) {
      warnings += ops.warningsOf(r);
      if (ops.isSynced(r)) {
        synced++;
      } else {
        await ops.markPermanent(ops.resultKey(r), ops.errorOf(r)); // status==='failed' business error
        permanentFailed++;
      }
    }
    return { synced, permanentFailed, transientFailed: 0, warnings, transportError: null, maxRetry: 0 };
  } catch (e) {
    const transportError = getErrorMessage(e, 'Sync error');
    const keys = sendable.map(ops.clientKey);
    const maxRetry = sendable.reduce((m, s) => Math.max(m, ops.retryCount(s)), 0);
    const next = new Date(Date.now() + backoffMs(maxRetry)).toISOString();
    await ops.markTransient(keys, next, transportError); // transport throw / non-2xx: backoff batch
    return { synced: 0, permanentFailed: 0, transientFailed: keys.length, warnings: 0, transportError, maxRetry };
  }
}

const customerOps: CreditQueueOps<LocalCustomer, SyncCustomerResult> = {
  getSendable: getSendableCustomers,
  clientKey: (c) => c.client_customer_id,
  retryCount: (c) => c.retry_count ?? 0,
  markSyncing: markCustomerSyncing,
  push: pushCustomersOnce,
  apply: applyCustomerIdMap, // synced/duplicate ONLY
  resultKey: (r) => r.client_customer_id,
  isSynced: (r) => r.status === 'synced' || r.status === 'duplicate',
  warningsOf: () => 0, // customers carry no warnings
  errorOf: (r) => r.error || 'Unknown error',
  markPermanent: markCustomerPermanentFailure,
  markTransient: markCustomerTransientFailure,
};

const paymentOps: CreditQueueOps<LocalCustomerPayment, SyncPaymentResult> = {
  getSendable: getSendablePayments,
  clientKey: (p) => p.client_payment_id,
  retryCount: (p) => p.retry_count ?? 0,
  markSyncing: markPaymentSyncing,
  push: pushPaymentsOnce,
  apply: applyPaymentResults, // synced/duplicate ONLY
  resultKey: (r) => r.client_payment_id,
  isSynced: (r) => r.status === 'synced' || r.status === 'duplicate',
  warningsOf: (r) => r.warnings?.length ?? 0,
  errorOf: (r) => r.error || 'Unknown error',
  markPermanent: markPaymentPermanentFailure,
  markTransient: markPaymentTransientFailure,
};
```

**(d)** Replace the whole `runPass` function (lines 140–239) with the ordered version:

```ts
async function runPass(reason: SyncReason, force = false): Promise<SyncPassResult> {
  const store = useSyncStore.getState();
  store.setEngineState('syncing');

  const online = await healthPing();
  store.setOnline(online);
  if (!online) {
    store.setEngineState('offline');
    await addSyncEvent('sync', 'skipped', `offline (${reason})`);
    await refreshCounts();
    return { synced: 0, permanentFailed: 0, transientFailed: 0, skipped: true };
  }

  const now = nowIso();
  await recoverSyncingSales(now);
  await recoverSyncingCustomers(now);
  await recoverSyncingPayments(now);

  let synced = 0;
  let permanentFailed = 0;
  let transientFailed = 0;
  let oversellWarnings = 0;
  let overpaymentWarnings = 0;
  let transportError: string | null = null;
  let maxRetry = 0;

  // 1) Customers first: applyCustomerIdMap fills customers.server_id so credit sales + payments
  //    (which reference client_customer_id) resolve server-side in this same pass (spec §4).
  const cust = await runCreditQueue(customerOps, now, force);
  synced += cust.synced;
  permanentFailed += cust.permanentFailed;
  transientFailed += cust.transientFailed;
  if (cust.transportError) {
    transportError = cust.transportError;
    maxRetry = Math.max(maxRetry, cust.maxRetry);
  }

  // 2) Sales (cash/card/mobile + credit). Skipped only when the customer push transport-failed:
  //    the network is down and credit sales could not resolve their customer yet.
  if (!transportError) {
    // force ⇒ also re-send permanent-failed rows (contract §4.2, the History "Повторить" path).
    const sendable = await getSendableSales(now, force ? { includePermanent: true } : undefined);
    if (sendable.length > 0) {
      for (const s of sendable) {
        await markSaleSyncing(s.id);
      }
      try {
        const results = await pushOnce(sendable);
        const idByClientId = new Map(sendable.map((s) => [s.client_sale_id, s.id]));
        for (const r of results) {
          const localId = idByClientId.get(r.client_sale_id);
          if (localId == null) continue;
          idByClientId.delete(r.client_sale_id);
          oversellWarnings += r.warnings?.length ?? 0; // oversell positions the server tolerated
          if (r.status === 'synced' || r.status === 'duplicate') {
            await markSaleSynced(localId, r.sale_id ?? null);
            synced++;
          } else {
            await markPermanentFailure(localId, r.error || 'Unknown error');
            permanentFailed++;
          }
        }
        // Any client_sale_id left in idByClientId had no result -> left 'syncing', cleaned next pass.
      } catch (e) {
        transportError = getErrorMessage(e, 'Sync error');
        const ids = sendable.map((s) => s.id);
        const salesMaxRetry = sendable.reduce((m, s) => Math.max(m, s.retry_count ?? 0), 0);
        const next = new Date(Date.now() + backoffMs(salesMaxRetry)).toISOString();
        await markTransientFailure(ids, next, transportError);
        transientFailed += ids.length;
        maxRetry = Math.max(maxRetry, salesMaxRetry);
      }
    }
  }

  // 3) Debt payments last: they also reference customers by client_customer_id, and the server
  //    caps each to the current balance (overpayment warning surfaced below).
  if (!transportError) {
    const pay = await runCreditQueue(paymentOps, now, force);
    synced += pay.synced;
    permanentFailed += pay.permanentFailed;
    transientFailed += pay.transientFailed;
    overpaymentWarnings += pay.warnings;
    if (pay.transportError) {
      transportError = pay.transportError;
      maxRetry = Math.max(maxRetry, pay.maxRetry);
    }
  }

  // 4) Pull catalog + customers only if nothing transport-failed (server now reflects the pushes).
  if (!transportError) {
    try {
      await maybeRefreshCatalog();
    } catch (e) {
      await addSyncEvent('catalog', 'error', getErrorMessage(e, 'Catalog refresh failed'));
    }
  }

  await refreshCounts();

  const warningCount = oversellWarnings + overpaymentWarnings;
  store.patch({ lastWarningCount: warningCount });

  // Spec §5.4 surfacing: oversell (sales) + overpayment (payments) get user-visible amber toasts.
  if (oversellWarnings > 0) {
    toast(`Синхронизировано, перерасход: ${oversellWarnings} позиций`, {
      icon: '⚠️',
      style: { background: '#f59e0b', color: '#111827' },
    });
  }
  if (overpaymentWarnings > 0) {
    toast(`Оплата превышает долг: ${overpaymentWarnings}`, {
      icon: '⚠️',
      style: { background: '#f59e0b', color: '#111827' },
    });
  }
  if (synced > 0 && permanentFailed > 0) {
    toast(`Отправлено ${synced} · требует внимания ${permanentFailed}`);
  }

  if (synced > 0) {
    store.patch({ lastSyncedAt: nowIso(), lastError: null });
    await setMeta('last_sync_at', nowIso());
  }
  if (transientFailed > 0) {
    const next = new Date(Date.now() + backoffMs(maxRetry)).toISOString();
    store.patch({
      lastError: transportError,
      nextRetryAt: next,
      hasRepeatedFailures: maxRetry >= REPEATED_FAILURE_THRESHOLD, // spec §4.7 chip
    });
    store.setEngineState('backing_off');
    scheduleRetry();
  } else {
    store.setEngineState('idle');
    store.patch({ nextRetryAt: null, hasRepeatedFailures: false });
  }
  await addSyncEvent(
    'sync',
    'completed',
    `reason=${reason} synced=${synced} perm=${permanentFailed} transient=${transientFailed}`,
  );
  return { synced, permanentFailed, transientFailed, skipped: false };
}
```

> Note: `scheduleRetry` and `maybeRefreshCatalog` are declared later/earlier in the module and are hoisted (`function` / `async function` declarations), so referencing them here is fine — unchanged from Phase 1. `nowIso`, `backoffMs`, `REPEATED_FAILURE_THRESHOLD`, and `healthPing` are all pre-existing.

> **Pass ordering (contract):** customers → sales → payments → pull, with `applyCustomerIdMap` applied **before** the credit-sales and payments pushes so the just-minted `customers.server_id` is available for the dependent rows in the *same* pass. A customer **transport** failure (network down / non-2xx) sets `transportError`, which **defers this pass's sales and payments pushes** (the `if (!transportError)` guards). This is intentional and acceptable: those queues are untouched (still `pending`) and self-heal on the next pass once the customer batch lands. Only a **business** `failed` result is terminal (marked permanent); it does not set `transportError` and so does not defer the later queues.

### Step 3.4 — Run and see it PASS

```
cd sellary-cashier && npx vitest run src/lib/__tests__/sync-engine.test.ts
```

Expected: PASS — the new `ordered credit pass` block is green **and** every pre-existing test still passes (empty customer/payment queues mean the sales path is byte-for-byte the Phase-1 behavior). Then run the full cashier suite to catch cross-file regressions (e.g. `sync-service.test.ts`, `pos-payload.test.ts`):

```
cd sellary-cashier && npx vitest run
```

Expected: all files pass. Then the typecheck gate:

```
cd sellary-cashier && npx tsc --noEmit
```

Expected: exit 0.

### Step 3.5 — Commit

```
git add sellary-cashier/src/lib/sync-engine.ts sellary-cashier/src/lib/__tests__/sync-engine.test.ts
git commit -m "feat(cashier): sequence credit queues in sync engine (customers->sales->payments)"
```

---

## Verification checklist (whole plan)

- `cd sellary-cashier && npx vitest run` — full cashier suite green (includes `sync-api`, `sync-service`, `sync-engine`).
- `cd sellary-cashier && npx tsc --noEmit` — exit 0 (strict + `noUnusedLocals` + `noUnusedParameters`).
- Ordering proven: `pushCustomersOnce` → `pushOnce` → `pushPaymentsOnce`, with `applyCustomerIdMap` before the sales push; a customer transport failure defers the pass's sales + payments (self-heals next pass).
- Failed-result ownership (contract §C-6): `apply*` handles only `synced`/`duplicate`; the engine marks per-result `failed` via `markCustomerPermanentFailure`/`markPaymentPermanentFailure`, and transport throws via `markCustomerTransientFailure`/`markPaymentTransientFailure`.
- Decimal coercion (contract §C-8): `pushPayments` and `fetchBootstrap` return real numbers — the `'30.00'` → `30` tests pass.
- Warnings: oversell (sales) and overpayment (payments) both fold into `lastWarningCount` and each fires its own amber toast.
- Backoff: customer and payment transport throws mark their own transient rows with a `backoffMs` schedule and put the engine into `backing_off`.
- Counts: `unsyncedCount` / `needsAttentionCount` = sales + credit, using the combined `getUnsyncedCreditCount()`/`getNeedsAttentionCreditCount()` DAOs directly (no re-summing separate customer/payment counts — contract §C-5).
- Non-credit sales path unchanged (all Phase-1 `sync-engine`/`sync-service` tests still pass with empty credit queues).
