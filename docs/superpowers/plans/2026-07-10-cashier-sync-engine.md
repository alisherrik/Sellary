# Background Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the ad-hoc `syncPendingSales` mutex with a singleton background sync engine that owns all triggers, single-flight+coalescing, a per-sale transient/permanent state machine, exponential backoff, crash recovery, and push-then-pull catalog reconciliation — surfacing all state through a Zustand `sync-store`.

**Architecture:** `sync-engine.ts` is the sole mutex owner. Every trigger (30s periodic, 10s health poll, OS reconnect, app focus, post-sale, manual) funnels into `requestSync(reason, opts?)`, which single-flights `runPass()`: health-ping → crash-recover → push sendable sales (`pushOnce`) → classify each result (synced/duplicate → synced; business error → permanent/no-retry; transport throw → transient/backoff) → collect oversell/mixed-batch warnings into toasts → conditionally pull the catalog (`pullCatalog` passes the RAW server snapshot to `upsertProducts`, the **sole** stock subtractor: `local = server − Σ unsynced`). `sync-service.ts` shrinks to two pure, mutex-free helpers. `sync-store.ts` (Zustand) is the single UI source of truth.

**Tech Stack:** TypeScript, Zustand 5, Vitest 4, Tauri 2 (`@tauri-apps/api/window` focus events), browser `online`/`offline`/`visibilitychange` events.

**Depends on:** **data-model** (Plan 2) and **offline-auth**. data-model provides the `sales`/`sale_items` DAO (`getSendableSales(nowIso, opts?)`, `markSaleSyncing`, `markSaleSynced`, `markTransientFailure`, `markPermanentFailure`, `recoverSyncingSales`, `getUnsyncedCount`, `getNeedsAttentionCount`, `getUnsyncedBaseQtyByProduct`) and the `SaleWithItems` type (consumed here by spec name), and — per contract §4.1 — `upsertProducts` as the **sole** stock subtractor. **offline-auth owns `CashierShell.tsx`**, so the engine start/stop effect (Task 7) is layered on top of offline-auth's version at the equivalent post-refactor spot.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `sellary-cashier/src/lib/sync-store.ts` | Create | Zustand store: `online`, `engineState`, `isSyncing`, `unsyncedCount`, `needsAttentionCount`, `lastSyncedAt`, `lastError`, `nextRetryAt`, `catalogRefreshedAt`, `lastWarningCount`, `hasRepeatedFailures` + setters + `syncNow`/`refreshCatalog` actions. |
| `sellary-cashier/src/lib/sync-service.ts` | Modify (full rewrite) | Reduce to two pure helpers `pushOnce` / `pullCatalog`; delete module `isSyncing` and `syncPendingSales`. `pullCatalog` passes RAW `bootstrap.products` to `upsertProducts` (no pre-subtraction). |
| `sellary-cashier/src/lib/sync-engine.ts` | Create | Singleton engine: triggers, single-flight+coalescing, `runPass`, classification, backoff, crash recovery, oversell/mixed-batch warning toasts, `maybeRefreshCatalog` cadence, lifecycle start/stop (loads `catalogRefreshedAt` from meta on init). |
| `sellary-cashier/src/lib/__tests__/sync-store.test.ts` | Create | Store state + setters + action delegation tests. |
| `sellary-cashier/src/lib/__tests__/sync-service.test.ts` | Modify (full rewrite) | `pushOnce` payload build + `pullCatalog` raw pass-through tests. |
| `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` | Create | Single-flight+coalescing, classification, recover, backoff, cadence, warning-toast tests. |
| `sellary-cashier/src/pages/CashierShell.tsx` | Modify | Add exactly ONE engine start/stop `useEffect`, layered **after** offline-auth's version. |
| `sellary-cashier/src/pages/POSPage.tsx` | **Not owned here** | **pos-ui owns POSPage (full rewrite).** sync-engine only exposes the engine API (`requestSync`, `sync-store`); pos-ui wires `requestSync('post-sale')` + the `Не отправлено: N` header badge. |
| `sellary-cashier/src/pages/SettingsPage.tsx` | Modify (additive append only) | Add the sync-status section using store `syncNow`/`unsyncedCount`; never a full-file replace. |

**Interface assumptions consumed from the data-model plan (by spec §2.10 names):**
`SaleWithItems` (sale columns + `items: { product_id; quantity; unit_price }[]`, incl. `retry_count`), `getSendableSales(nowIso: string, opts?: { includePermanent?: boolean })` (default = `pending` OR transient-due; `includePermanent:true` also returns permanent-failed rows so a forced retry re-sends them), `markSaleSyncing(id)`, `markSaleSynced(id, serverSaleId|null)`, `markTransientFailure(ids, nextAttemptAt, error)`, `markPermanentFailure(id, error)`, `recoverSyncingSales(nowIso)`, `getUnsyncedCount()`, `getNeedsAttentionCount()`, `getUnsyncedBaseQtyByProduct()`. Existing `db.ts` exports still present: `upsertProducts` (per contract §4.1 the **sole** stock subtractor — `pullCatalog` hands it the raw server snapshot and must NOT pre-subtract), `upsertCategories`, `getMeta`, `setMeta`, `addSyncEvent`, `LocalProduct`. Existing `api.ts`: `checkHealth`, `fetchBootstrap`, `pushSales`, types `SyncSale`, `SyncSaleResult` (incl. `warnings: string[] | null`), `SyncBootstrapResponse`. Toasts: `react-hot-toast` (installed by pos-ui; `<Toaster/>` mounted in `App.tsx` by offline-auth).

---

## Task 1: `sync-store.ts` — Zustand state + actions

**Files:**
- Create: `sellary-cashier/src/lib/sync-store.ts`
- Test: `sellary-cashier/src/lib/__tests__/sync-store.test.ts`

Steps:

- [ ] **Write the failing test.** Create `sellary-cashier/src/lib/__tests__/sync-store.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';

  const { mockSyncNow, mockRefreshCatalog } = vi.hoisted(() => ({
    mockSyncNow: vi.fn(),
    mockRefreshCatalog: vi.fn(),
  }));

  vi.mock('../sync-engine', () => ({
    syncNow: mockSyncNow,
    refreshCatalog: mockRefreshCatalog,
  }));

  import { useSyncStore, initialSyncState } from '../sync-store';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncNow.mockResolvedValue(undefined);
    mockRefreshCatalog.mockResolvedValue(undefined);
    useSyncStore.setState(initialSyncState);
  });

  describe('sync-store', () => {
    it('starts from the offline/idle initial snapshot', () => {
      const s = useSyncStore.getState();
      expect(s.online).toBe(false);
      expect(s.engineState).toBe('idle');
      expect(s.isSyncing).toBe(false);
      expect(s.unsyncedCount).toBe(0);
      expect(s.needsAttentionCount).toBe(0);
      expect(s.lastSyncedAt).toBeNull();
      expect(s.nextRetryAt).toBeNull();
      expect(s.catalogRefreshedAt).toBeNull();
      expect(s.lastWarningCount).toBe(0);
      expect(s.hasRepeatedFailures).toBe(false);
    });

    it('setOnline flips only the online flag', () => {
      useSyncStore.getState().setOnline(true);
      expect(useSyncStore.getState().online).toBe(true);
    });

    it('setEngineState derives isSyncing from the syncing state', () => {
      useSyncStore.getState().setEngineState('syncing');
      expect(useSyncStore.getState().isSyncing).toBe(true);
      useSyncStore.getState().setEngineState('backing_off');
      expect(useSyncStore.getState().isSyncing).toBe(false);
    });

    it('patch merges a partial snapshot', () => {
      useSyncStore.getState().patch({ unsyncedCount: 3, lastError: 'boom' });
      const s = useSyncStore.getState();
      expect(s.unsyncedCount).toBe(3);
      expect(s.lastError).toBe('boom');
    });

    it('syncNow action delegates to the engine', async () => {
      await useSyncStore.getState().syncNow();
      expect(mockSyncNow).toHaveBeenCalledTimes(1);
    });

    it('refreshCatalog action delegates to the engine', async () => {
      await useSyncStore.getState().refreshCatalog();
      expect(mockRefreshCatalog).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Run it and see it FAIL.** Command: `npx vitest run src/lib/__tests__/sync-store.test.ts`. Expected failure: `Failed to resolve import "../sync-store"` (the module does not exist yet).

- [ ] **Minimal implementation.** Create `sellary-cashier/src/lib/sync-store.ts`:
  ```ts
  import { create } from 'zustand';

  export type EngineState = 'idle' | 'syncing' | 'backing_off' | 'offline';

  export interface SyncSnapshot {
    online: boolean;
    engineState: EngineState;
    isSyncing: boolean;
    unsyncedCount: number;
    needsAttentionCount: number;
    lastSyncedAt: string | null;
    lastError: string | null;
    nextRetryAt: string | null;
    catalogRefreshedAt: string | null;
    lastWarningCount: number;
    hasRepeatedFailures: boolean;
  }

  export interface SyncStore extends SyncSnapshot {
    setOnline: (online: boolean) => void;
    setEngineState: (engineState: EngineState) => void;
    patch: (partial: Partial<SyncSnapshot>) => void;
    syncNow: () => Promise<void>;
    refreshCatalog: () => Promise<void>;
  }

  export const initialSyncState: SyncSnapshot = {
    online: false,
    engineState: 'idle',
    isSyncing: false,
    unsyncedCount: 0,
    needsAttentionCount: 0,
    lastSyncedAt: null,
    lastError: null,
    nextRetryAt: null,
    catalogRefreshedAt: null,
    lastWarningCount: 0,
    hasRepeatedFailures: false,
  };

  export const useSyncStore = create<SyncStore>((set) => ({
    ...initialSyncState,
    setOnline: (online) => set({ online }),
    setEngineState: (engineState) =>
      set({ engineState, isSyncing: engineState === 'syncing' }),
    patch: (partial) => set(partial),
    // Dynamic import breaks the static engine→store cycle (engine imports the store statically).
    syncNow: async () => {
      const { syncNow } = await import('./sync-engine');
      await syncNow();
    },
    refreshCatalog: async () => {
      const { refreshCatalog } = await import('./sync-engine');
      await refreshCatalog();
    },
  }));
  ```

- [ ] **Run it and see it PASS.** Command: `npx vitest run src/lib/__tests__/sync-store.test.ts`. Expected: 6 passing.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/lib/sync-store.ts sellary-cashier/src/lib/__tests__/sync-store.test.ts
  git commit -m "feat(cashier): add sync-store zustand state for the sync engine"
  ```

---

## Task 2: Reduce `sync-service.ts` to `pushOnce` + `pullCatalog`

**Files:**
- Modify: `sellary-cashier/src/lib/sync-service.ts` (full rewrite; delete `isSyncing` + `syncPendingSales`)
- Test: `sellary-cashier/src/lib/__tests__/sync-service.test.ts` (full rewrite)

Steps:

- [ ] **Write the failing test.** Replace the entire contents of `sellary-cashier/src/lib/__tests__/sync-service.test.ts` with:
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest';

  const {
    mockPushSales,
    mockFetchBootstrap,
    mockUpsertProducts,
    mockUpsertCategories,
    mockSetMeta,
  } = vi.hoisted(() => ({
    mockPushSales: vi.fn(),
    mockFetchBootstrap: vi.fn(),
    mockUpsertProducts: vi.fn(),
    mockUpsertCategories: vi.fn(),
    mockSetMeta: vi.fn(),
  }));

  vi.mock('../api', () => ({
    pushSales: mockPushSales,
    fetchBootstrap: mockFetchBootstrap,
  }));

  // Per contract §4.1, sync-service does NOT import getUnsyncedBaseQtyByProduct —
  // upsertProducts (data-model) is the sole stock subtractor. pullCatalog only forwards raw products.
  vi.mock('../db', () => ({
    upsertProducts: mockUpsertProducts,
    upsertCategories: mockUpsertCategories,
    setMeta: mockSetMeta,
  }));

  import { pushOnce, pullCatalog } from '../sync-service';

  function makeSale(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1,
      client_sale_id: 'sale-1',
      idempotency_key: 'idem-1',
      created_at_client: '2026-07-10T00:00:00.000Z',
      payment_method: 'cash',
      card_type: null,
      discount_amount: 0,
      paid_amount: 100,
      change_amount: 0,
      notes: null,
      retry_count: 0,
      items: [{ product_id: 7, quantity: 3, unit_price: 50 }],
      ...overrides,
    } as never;
  }

  function makeServerProduct(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 7,
      barcode: null,
      name: 'Cola',
      uom: 'pcs',
      category_id: null,
      sell_price: 50,
      tax_percent: 0,
      stock_quantity: 100,
      is_active: true,
      updated_at: '2026-07-10T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertProducts.mockResolvedValue(undefined);
    mockUpsertCategories.mockResolvedValue(undefined);
    mockSetMeta.mockResolvedValue(undefined);
  });

  describe('pushOnce', () => {
    it('maps SaleWithItems to the SyncSale payload (unit_price -> sell_price, base quantity)', async () => {
      mockPushSales.mockResolvedValue({
        results: [{ client_sale_id: 'sale-1', status: 'synced', sale_id: 900, warnings: null, error: null }],
      });

      const results = await pushOnce([makeSale()]);

      expect(mockPushSales).toHaveBeenCalledTimes(1);
      const payload = mockPushSales.mock.calls[0][0];
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
          items: [{ product_id: 7, quantity: 3, sell_price: 50 }],
        },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('synced');
    });
  });

  describe('pullCatalog raw pass-through (contract §4.1: upsertProducts is the sole subtractor)', () => {
    it('forwards the RAW server products to upsertProducts without pre-subtracting unsynced qty', async () => {
      mockFetchBootstrap.mockResolvedValue({
        server_time: '2026-07-10T01:00:00.000Z',
        products: [makeServerProduct({ id: 7, stock_quantity: 100 })],
        categories: [{ id: 1, name: 'Drinks', is_active: true, updated_at: null }],
      });

      const res = await pullCatalog();

      expect(mockUpsertCategories).toHaveBeenCalledTimes(1);
      const upserted = mockUpsertProducts.mock.calls[0][0];
      // Raw server stock — subtraction happens exactly once, inside upsertProducts.
      expect(upserted[0].stock_quantity).toBe(100);
      expect(mockSetMeta).toHaveBeenCalledWith('last_catalog_pull_at', '2026-07-10T01:00:00.000Z');
      expect(res).toEqual({ products: 1, categories: 1 });
    });

    it('passes bootstrap.products through by reference/value, unmodified across repeated pulls', async () => {
      mockFetchBootstrap.mockResolvedValue({
        server_time: '2026-07-10T01:00:00.000Z',
        products: [makeServerProduct({ id: 7, stock_quantity: 100 })],
        categories: [],
      });

      await pullCatalog();
      await pullCatalog();

      expect(mockUpsertProducts.mock.calls[0][0][0].stock_quantity).toBe(100);
      expect(mockUpsertProducts.mock.calls[1][0][0].stock_quantity).toBe(100);
    });
  });
  ```

- [ ] **Run it and see it FAIL.** Command: `npx vitest run src/lib/__tests__/sync-service.test.ts`. Expected failure: `pushOnce is not a function` / `pullCatalog is not a function` (the old module only exports `syncPendingSales`).

- [ ] **Minimal implementation.** Replace the entire contents of `sellary-cashier/src/lib/sync-service.ts` with:
  ```ts
  import { fetchBootstrap, pushSales } from './api';
  import type { SyncSale, SyncSaleResult } from './api';
  import { upsertProducts, upsertCategories, setMeta } from './db';
  import type { SaleWithItems } from './db';

  /**
   * Build the SyncSale payload deterministically from structured columns and push it.
   * Pure + mutex-free: the engine owns the single-flight lock and all state writes.
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
   * Full-refresh catalog pull (spec §5.2). Per contract §4.1, stock reconciliation
   *   local_stock(p) = server_stock(p) - Σ base_qty(p) over sales sync_status ∈ {pending,syncing,failed}
   * lives ENTIRELY inside `upsertProducts` (the sole subtractor). pullCatalog MUST forward the
   * RAW server snapshot — pre-subtracting here would double-count (local = server − 2×Σunsynced),
   * halving offline stock on every reconnect.
   */
  export async function pullCatalog(): Promise<{ products: number; categories: number }> {
    const bootstrap = await fetchBootstrap();
    await upsertCategories(bootstrap.categories);
    await upsertProducts(bootstrap.products); // RAW products — upsertProducts subtracts unsynced qty
    await setMeta('last_catalog_pull_at', bootstrap.server_time);
    return { products: bootstrap.products.length, categories: bootstrap.categories.length };
  }
  ```

- [ ] **Run it and see it PASS.** Command: `npx vitest run src/lib/__tests__/sync-service.test.ts`. Expected: 3 passing.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/lib/sync-service.ts sellary-cashier/src/lib/__tests__/sync-service.test.ts
  git commit -m "refactor(cashier): reduce sync-service to pure pushOnce/pullCatalog helpers"
  ```

---

## Task 3: `sync-engine.ts` — backoff + `runPass` push/classify/reconcile core

**Files:**
- Create: `sellary-cashier/src/lib/sync-engine.ts`
- Test: `sellary-cashier/src/lib/__tests__/sync-engine.test.ts`

Steps:

- [ ] **Write the failing test.** Create `sellary-cashier/src/lib/__tests__/sync-engine.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

  const {
    mockCheckHealth,
    mockPushOnce,
    mockPullCatalog,
    mockGetSendableSales,
    mockMarkSaleSyncing,
    mockMarkSaleSynced,
    mockMarkTransientFailure,
    mockMarkPermanentFailure,
    mockRecoverSyncingSales,
    mockGetUnsyncedCount,
    mockGetNeedsAttentionCount,
    mockGetMeta,
    mockSetMeta,
    mockAddSyncEvent,
    mockToast,
    mockToastSuccess,
  } = vi.hoisted(() => ({
    mockCheckHealth: vi.fn(),
    mockPushOnce: vi.fn(),
    mockPullCatalog: vi.fn(),
    mockGetSendableSales: vi.fn(),
    mockMarkSaleSyncing: vi.fn(),
    mockMarkSaleSynced: vi.fn(),
    mockMarkTransientFailure: vi.fn(),
    mockMarkPermanentFailure: vi.fn(),
    mockRecoverSyncingSales: vi.fn(),
    mockGetUnsyncedCount: vi.fn(),
    mockGetNeedsAttentionCount: vi.fn(),
    mockGetMeta: vi.fn(),
    mockSetMeta: vi.fn(),
    mockAddSyncEvent: vi.fn(),
    mockToast: vi.fn(),
    mockToastSuccess: vi.fn(),
  }));

  vi.mock('../api', () => ({ checkHealth: mockCheckHealth }));
  vi.mock('../sync-service', () => ({ pushOnce: mockPushOnce, pullCatalog: mockPullCatalog }));
  vi.mock('react-hot-toast', () => ({
    __esModule: true,
    default: Object.assign(mockToast, { success: mockToastSuccess }),
    toast: Object.assign(mockToast, { success: mockToastSuccess }),
  }));
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
  }));

  import { requestSync, backoffMs, __resetEngineForTests } from '../sync-engine';
  import { useSyncStore, initialSyncState } from '../sync-store';

  function makeSale(id: number, clientId: string, retry = 0) {
    return {
      id,
      client_sale_id: clientId,
      idempotency_key: `idem-${id}`,
      created_at_client: '2026-07-10T00:00:00.000Z',
      payment_method: 'cash',
      card_type: null,
      discount_amount: 0,
      paid_amount: 100,
      change_amount: 0,
      notes: null,
      retry_count: retry,
      items: [{ product_id: 7, quantity: 1, unit_price: 100 }],
    } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetEngineForTests();
    useSyncStore.setState(initialSyncState);
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetSendableSales.mockResolvedValue([]);
    mockGetUnsyncedCount.mockResolvedValue(0);
    mockGetNeedsAttentionCount.mockResolvedValue(0);
    mockGetMeta.mockResolvedValue(new Date().toISOString()); // catalog fresh -> pull not due
    mockSetMeta.mockResolvedValue(undefined);
    mockAddSyncEvent.mockResolvedValue(undefined);
    mockPullCatalog.mockResolvedValue({ products: 0, categories: 0 });
    mockMarkSaleSyncing.mockResolvedValue(undefined);
    mockMarkSaleSynced.mockResolvedValue(undefined);
    mockMarkTransientFailure.mockResolvedValue(undefined);
    mockMarkPermanentFailure.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetEngineForTests();
    vi.useRealTimers();
  });

  describe('runPass classification', () => {
    it('goes offline and skips push when the health ping fails', async () => {
      mockCheckHealth.mockResolvedValue(false);

      const res = await requestSync('manual');

      expect(res.skipped).toBe(true);
      expect(mockRecoverSyncingSales).not.toHaveBeenCalled();
      expect(mockPushOnce).not.toHaveBeenCalled();
      expect(useSyncStore.getState().engineState).toBe('offline');
      expect(useSyncStore.getState().online).toBe(false);
    });

    it('recovers interrupted syncing sales before reading sendable sales', async () => {
      await requestSync('manual');
      expect(mockRecoverSyncingSales).toHaveBeenCalledTimes(1);
      expect(mockGetSendableSales).toHaveBeenCalledTimes(1);
    });

    it('marks synced/duplicate results as synced and stores server ids', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a'), makeSale(2, 'b')]);
      mockPushOnce.mockResolvedValue([
        { client_sale_id: 'a', status: 'synced', sale_id: 900, warnings: null, error: null },
        { client_sale_id: 'b', status: 'duplicate', sale_id: null, warnings: null, error: null },
      ]);

      const res = await requestSync('manual');

      expect(mockMarkSaleSyncing).toHaveBeenCalledWith(1);
      expect(mockMarkSaleSyncing).toHaveBeenCalledWith(2);
      expect(mockMarkSaleSynced).toHaveBeenCalledWith(1, 900);
      expect(mockMarkSaleSynced).toHaveBeenCalledWith(2, null);
      expect(res.synced).toBe(2);
      expect(useSyncStore.getState().engineState).toBe('idle');
    });

    it('classifies a per-sale business error as permanent (no retry queue)', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
      mockPushOnce.mockResolvedValue([
        { client_sale_id: 'a', status: 'failed', sale_id: null, warnings: null, error: 'Products not found' },
      ]);

      const res = await requestSync('manual');

      expect(mockMarkPermanentFailure).toHaveBeenCalledWith(1, 'Products not found');
      expect(mockMarkTransientFailure).not.toHaveBeenCalled();
      expect(res.permanentFailed).toBe(1);
    });

    it('classifies a transport throw as transient with a backoff schedule for the whole batch', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a'), makeSale(2, 'b')]);
      mockPushOnce.mockRejectedValue(new Error('Network failure'));

      const res = await requestSync('manual');

      expect(mockMarkTransientFailure).toHaveBeenCalledTimes(1);
      const [ids, nextAttemptAt, error] = mockMarkTransientFailure.mock.calls[0];
      expect(ids).toEqual([1, 2]);
      expect(typeof nextAttemptAt).toBe('string');
      expect(new Date(nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
      expect(error).toBe('Network failure');
      expect(res.transientFailed).toBe(2);
      expect(useSyncStore.getState().engineState).toBe('backing_off');
      expect(useSyncStore.getState().lastError).toBe('Network failure');
    });

    it('does not pull the catalog when the push transport-failed', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
      mockPushOnce.mockRejectedValue(new Error('Network failure'));
      mockGetMeta.mockResolvedValue(null); // pull would otherwise be due

      await requestSync('manual');

      expect(mockPullCatalog).not.toHaveBeenCalled();
    });
  });

  describe('warning surfacing + force resend', () => {
    it('emits an amber oversell toast and stores lastWarningCount from result warnings', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
      mockPushOnce.mockResolvedValue([
        {
          client_sale_id: 'a',
          status: 'synced',
          sale_id: 900,
          warnings: ['Кола: перерасход 3', 'Сок: перерасход 1'],
          error: null,
        },
      ]);

      await requestSync('manual');

      expect(mockToast).toHaveBeenCalledWith(
        'Синхронизировано, перерасход: 2 позиций',
        expect.objectContaining({ icon: '⚠️' }),
      );
      expect(useSyncStore.getState().lastWarningCount).toBe(2);
    });

    it('emits a mixed-batch toast when some sales sync and others fail permanently', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a'), makeSale(2, 'b')]);
      mockPushOnce.mockResolvedValue([
        { client_sale_id: 'a', status: 'synced', sale_id: 900, warnings: null, error: null },
        { client_sale_id: 'b', status: 'failed', sale_id: null, warnings: null, error: 'Products not found' },
      ]);

      await requestSync('manual');

      expect(mockToast).toHaveBeenCalledWith('Отправлено 1 · требует внимания 1');
    });

    it('sets hasRepeatedFailures when a transient batch has retry_count >= 8', async () => {
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a', 8)]);
      mockPushOnce.mockRejectedValue(new Error('Network failure'));

      await requestSync('manual');

      expect(useSyncStore.getState().hasRepeatedFailures).toBe(true);
    });

    it('force:true requests sendable sales including permanent-failed rows', async () => {
      mockGetSendableSales.mockResolvedValue([]);

      await requestSync('manual', { force: true });

      expect(mockGetSendableSales).toHaveBeenCalledWith(
        expect.any(String),
        { includePermanent: true },
      );
    });

    it('default (unforced) requests sendable sales without the includePermanent flag', async () => {
      mockGetSendableSales.mockResolvedValue([]);

      await requestSync('manual');

      expect(mockGetSendableSales).toHaveBeenCalledWith(expect.any(String), undefined);
    });
  });

  describe('backoffMs', () => {
    it('grows exponentially from a 5s base with the midpoint jitter', () => {
      const rand = () => 0.5; // jitter factor -> 1.0
      expect(backoffMs(0, rand)).toBe(5000);
      expect(backoffMs(1, rand)).toBe(10000);
      expect(backoffMs(3, rand)).toBe(40000);
    });

    it('caps at 5 minutes (plus jitter headroom) and never goes negative', () => {
      expect(backoffMs(20, () => 1)).toBeLessThanOrEqual(5 * 60_000 * 1.2);
      expect(backoffMs(20, () => 0)).toBeGreaterThanOrEqual(0);
    });
  });
  ```

- [ ] **Run it and see it FAIL.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts`. Expected failure: `Failed to resolve import "../sync-engine"`.

- [ ] **Minimal implementation.** Create `sellary-cashier/src/lib/sync-engine.ts` with the core (triggers/lifecycle added in later tasks):
  ```ts
  import { checkHealth } from './api';
  import { pushOnce, pullCatalog } from './sync-service';
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
  } from './db';
  import { useSyncStore } from './sync-store';
  import { getErrorMessage } from './error';
  import { toast } from 'react-hot-toast';

  export type SyncReason =
    | 'periodic'
    | 'reconnect'
    | 'focus'
    | 'post-sale'
    | 'manual'
    | 'coalesced';

  const REPEATED_FAILURE_THRESHOLD = 8; // spec §4.7: retry_count >= 8 is a "repeated failure"

  export interface SyncPassResult {
    synced: number;
    permanentFailed: number;
    transientFailed: number;
    skipped: boolean;
  }

  const BACKOFF_BASE_MS = 5_000;
  const BACKOFF_CAP_MS = 5 * 60_000;
  const BACKOFF_JITTER = 0.2;
  const HEALTH_TIMEOUT_MS = 4_000;
  const CATALOG_REFRESH_INTERVAL_MS = 15 * 60_000;

  export function backoffMs(retryCount: number, rand: () => number = Math.random): number {
    const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, retryCount));
    const jitter = 1 + (rand() * 2 - 1) * BACKOFF_JITTER; // 1 ± 0.2
    const capped = Math.min(BACKOFF_CAP_MS * (1 + BACKOFF_JITTER), exp * jitter);
    return Math.round(Math.max(0, capped));
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  async function healthPing(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
    });
    try {
      return await Promise.race([checkHealth(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function refreshCounts(): Promise<void> {
    const [unsynced, needsAttention] = await Promise.all([
      getUnsyncedCount(),
      getNeedsAttentionCount(),
    ]);
    useSyncStore.getState().patch({
      unsyncedCount: unsynced,
      needsAttentionCount: needsAttention,
    });
  }

  export async function maybeRefreshCatalog(force = false): Promise<void> {
    const last = await getMeta('last_catalog_pull_at');
    const due =
      force || !last || Date.now() - new Date(last).getTime() >= CATALOG_REFRESH_INTERVAL_MS;
    if (!due) return;
    const res = await pullCatalog();
    useSyncStore.getState().patch({ catalogRefreshedAt: nowIso() });
    await addSyncEvent('catalog', 'completed', `products=${res.products} categories=${res.categories}`);
  }

  // --- single-flight + coalescing (Task 4 wires the public entry point) ---
  let inFlight: Promise<SyncPassResult> | null = null;
  let rerunRequested = false;
  let rerunForce = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  export function requestSync(
    reason: SyncReason,
    opts?: { force?: boolean },
  ): Promise<SyncPassResult> {
    if (inFlight) {
      // Coalesce: remember a force request so the follow-up pass re-sends permanent-failed rows.
      rerunRequested = true;
      if (opts?.force) rerunForce = true;
      return inFlight;
    }
    const force = opts?.force ?? false;
    inFlight = runPass(reason, force).finally(() => {
      inFlight = null;
      if (rerunRequested) {
        rerunRequested = false;
        const nextForce = rerunForce;
        rerunForce = false;
        void requestSync('coalesced', { force: nextForce });
      }
    });
    return inFlight;
  }

  function scheduleRetry(): void {
    const next = useSyncStore.getState().nextRetryAt;
    if (!next) return;
    const delay = Math.max(0, new Date(next).getTime() - Date.now());
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void requestSync('periodic');
    }, delay);
  }

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

    await recoverSyncingSales(nowIso());

    let synced = 0;
    let permanentFailed = 0;
    let transientFailed = 0;
    let warningCount = 0;
    let transportError: string | null = null;

    // force ⇒ also re-send permanent-failed rows (contract §4.2, the History "Повторить" path).
    const sendable = await getSendableSales(nowIso(), force ? { includePermanent: true } : undefined);
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
          warningCount += r.warnings?.length ?? 0; // oversell positions the server tolerated
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
        const maxRetry = sendable.reduce((m, s) => Math.max(m, s.retry_count ?? 0), 0);
        const next = new Date(Date.now() + backoffMs(maxRetry)).toISOString();
        await markTransientFailure(ids, next, transportError);
        transientFailed = ids.length;
        store.patch({
          lastError: transportError,
          nextRetryAt: next,
          hasRepeatedFailures: maxRetry >= REPEATED_FAILURE_THRESHOLD, // spec §4.7 chip
        });
      }
    }

    // Pull only if the push did not just raise a transport error (server stock now reflects synced sales).
    if (!transportError) {
      try {
        await maybeRefreshCatalog();
      } catch (e) {
        await addSyncEvent('catalog', 'error', getErrorMessage(e, 'Catalog refresh failed'));
      }
    }

    await refreshCounts();
    store.patch({ lastWarningCount: warningCount });

    // Spec §5.4 surfacing: oversell + mixed-batch outcomes get user-visible toasts.
    if (warningCount > 0) {
      toast(`Синхронизировано, перерасход: ${warningCount} позиций`, {
        icon: '⚠️',
        style: { background: '#f59e0b', color: '#111827' }, // amber
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

  export function __resetEngineForTests(): void {
    inFlight = null;
    rerunRequested = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  ```

- [ ] **Run it and see it PASS.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts`. Expected: all `runPass classification` + `backoffMs` tests passing.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/lib/sync-engine.ts sellary-cashier/src/lib/__tests__/sync-engine.test.ts
  git commit -m "feat(cashier): add sync-engine runPass with transient/permanent classification and backoff"
  ```

---

## Task 4: Single-flight + coalescing guarantee

**Files:**
- Modify: `sellary-cashier/src/lib/sync-engine.ts` (already implements `requestSync`; add `syncNow`)
- Test: `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (append a `describe` block)

Steps:

- [ ] **Write the failing test.** Append to `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (add `syncNow` to the import from `../sync-engine`, then the block):
  ```ts
  // add `syncNow` to: import { requestSync, syncNow, backoffMs, __resetEngineForTests } from '../sync-engine';

  describe('single-flight + coalescing', () => {
    it('returns the same in-flight promise to concurrent callers', async () => {
      let resolvePush: (v: unknown) => void = () => {};
      mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
      mockPushOnce.mockImplementation(
        () => new Promise((r) => { resolvePush = r; }),
      );

      const p1 = requestSync('manual');
      const p2 = requestSync('post-sale');
      expect(p2).toBe(p1);

      resolvePush([{ client_sale_id: 'a', status: 'synced', sale_id: 1, warnings: null, error: null }]);
      await p1;
      await Promise.resolve();
    });

    it('coalesces a burst of requests into at most one active pass plus one rerun', async () => {
      mockGetSendableSales.mockResolvedValue([]); // no push work; passes are cheap

      const first = requestSync('manual');
      requestSync('post-sale');
      requestSync('focus');
      requestSync('periodic');
      await first;
      // allow the coalesced rerun to run to completion
      await new Promise((r) => setTimeout(r, 0));

      // 1 active pass + exactly 1 coalesced rerun = 2 health pings, never 4.
      expect(mockCheckHealth).toHaveBeenCalledTimes(2);
    });

    it('syncNow drives a manual pass', async () => {
      mockGetSendableSales.mockResolvedValue([]);
      const res = await syncNow();
      expect(res.skipped).toBe(false);
      expect(mockCheckHealth).toHaveBeenCalled();
    });
  });
  ```

- [ ] **Run it and see it FAIL.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts -t "single-flight"`. Expected failure: `syncNow is not exported by '../sync-engine'` (the block imports `syncNow`, which does not exist yet).

- [ ] **Minimal implementation.** Add `syncNow` (and `refreshCatalog`, used later by the store) to `sellary-cashier/src/lib/sync-engine.ts`, immediately after the `requestSync` function:
  ```ts
  export function syncNow(): Promise<SyncPassResult> {
    return requestSync('manual');
  }

  export async function refreshCatalog(): Promise<{ products: number; categories: number }> {
    const res = await pullCatalog();
    useSyncStore.getState().patch({ catalogRefreshedAt: nowIso() });
    await addSyncEvent('catalog', 'completed', `manual products=${res.products} categories=${res.categories}`);
    return res;
  }
  ```

- [ ] **Run it and see it PASS.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts`. Expected: all passing including the single-flight block.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/lib/sync-engine.ts sellary-cashier/src/lib/__tests__/sync-engine.test.ts
  git commit -m "feat(cashier): expose syncNow/refreshCatalog and verify single-flight coalescing"
  ```

---

## Task 5: `maybeRefreshCatalog` cadence

**Files:**
- Modify: `sellary-cashier/src/lib/sync-engine.ts` (`maybeRefreshCatalog` already implemented in Task 3 — this task adds coverage)
- Test: `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (append a `describe` block)

Steps:

- [ ] **Write the failing test.** Append to `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (add `maybeRefreshCatalog` to the import), then:
  ```ts
  // add `maybeRefreshCatalog` to the import from '../sync-engine'

  describe('maybeRefreshCatalog cadence', () => {
    it('skips the pull when the catalog was refreshed within the interval', async () => {
      mockGetMeta.mockResolvedValue(new Date().toISOString());
      await maybeRefreshCatalog();
      expect(mockPullCatalog).not.toHaveBeenCalled();
    });

    it('pulls when the catalog is stale (older than the interval)', async () => {
      mockGetMeta.mockResolvedValue(new Date(Date.now() - 20 * 60_000).toISOString());
      await maybeRefreshCatalog();
      expect(mockPullCatalog).toHaveBeenCalledTimes(1);
      expect(useSyncStore.getState().catalogRefreshedAt).not.toBeNull();
    });

    it('pulls when there is no prior pull timestamp', async () => {
      mockGetMeta.mockResolvedValue(null);
      await maybeRefreshCatalog();
      expect(mockPullCatalog).toHaveBeenCalledTimes(1);
    });

    it('force pulls regardless of freshness', async () => {
      mockGetMeta.mockResolvedValue(new Date().toISOString());
      await maybeRefreshCatalog(true);
      expect(mockPullCatalog).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Run it and see it FAIL.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts -t "maybeRefreshCatalog"`. Expected failure BEFORE the import is added: `maybeRefreshCatalog is not exported`. (It is already implemented in Task 3, so the only change needed is adding it to the test import — run first to confirm the block is red, then add the import.)

- [ ] **Minimal implementation.** No engine change is required — `maybeRefreshCatalog` already exists. Confirm it is added to the test's import statement from `'../sync-engine'`.

- [ ] **Run it and see it PASS.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts`. Expected: cadence block passes.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/lib/__tests__/sync-engine.test.ts
  git commit -m "test(cashier): cover maybeRefreshCatalog freshness cadence"
  ```

---

## Task 6: Triggers + lifecycle (`startSyncEngine` / `stopSyncEngine`)

**Files:**
- Modify: `sellary-cashier/src/lib/sync-engine.ts` (append lifecycle + trigger wiring)
- Test: `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (append a `describe` block)

Steps:

- [ ] **Write the failing test.** Append to `sellary-cashier/src/lib/__tests__/sync-engine.test.ts` (add `startSyncEngine`, `stopSyncEngine` to the import):
  ```ts
  // add `startSyncEngine, stopSyncEngine` to the import from '../sync-engine'

  describe('triggers + lifecycle', () => {
    afterEach(() => {
      stopSyncEngine();
      vi.useRealTimers();
    });

    it('the 30s periodic timer only fires a pass while unsyncedCount > 0', async () => {
      vi.useFakeTimers();
      mockCheckHealth.mockResolvedValue(true);
      mockGetSendableSales.mockResolvedValue([]);
      mockGetUnsyncedCount.mockResolvedValue(0);

      startSyncEngine();
      // startup runs one immediate pollHealth; ignore checkHealth counts from that.
      const baseline = mockCheckHealth.mock.calls.length;

      // unsyncedCount is 0 -> periodic tick must NOT start a pass.
      await vi.advanceTimersByTimeAsync(30_000);
      // Only the 10s health poll(s) may have pinged; the periodic pass added none.
      useSyncStore.setState({ unsyncedCount: 2 });
      const beforeArmed = mockGetSendableSales.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockGetSendableSales.mock.calls.length).toBeGreaterThan(beforeArmed);
      expect(baseline).toBeGreaterThanOrEqual(1);
    });

    it('a health poll that flips offline->online triggers a reconnect pass and a forced catalog pull', async () => {
      vi.useFakeTimers();
      useSyncStore.setState({ online: false });
      mockCheckHealth.mockResolvedValue(true);
      mockGetSendableSales.mockResolvedValue([]);
      mockGetMeta.mockResolvedValue(new Date().toISOString());

      startSyncEngine();
      await vi.advanceTimersByTimeAsync(0); // let the startup pollHealth resolve

      expect(useSyncStore.getState().online).toBe(true);
      expect(mockPullCatalog).toHaveBeenCalled(); // forced pull on reconnect
    });

    it('stopSyncEngine clears timers so no further passes run', async () => {
      vi.useFakeTimers();
      mockCheckHealth.mockResolvedValue(true);
      startSyncEngine();
      stopSyncEngine();
      const before = mockCheckHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockCheckHealth.mock.calls.length).toBe(before);
    });

    it('hydrates catalogRefreshedAt from meta(last_catalog_pull_at) on start (cold-start chip)', async () => {
      vi.useFakeTimers();
      const ts = '2026-07-03T00:00:00.000Z';
      mockGetMeta.mockResolvedValue(ts);
      mockCheckHealth.mockResolvedValue(true);

      startSyncEngine();
      await vi.advanceTimersByTimeAsync(0); // let the meta read resolve

      expect(useSyncStore.getState().catalogRefreshedAt).toBe(ts);
    });
  });
  ```

- [ ] **Run it and see it FAIL.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts -t "triggers"`. Expected failure: `startSyncEngine is not exported by '../sync-engine'`.

- [ ] **Minimal implementation.** Append the lifecycle + trigger block to `sellary-cashier/src/lib/sync-engine.ts` (before `__resetEngineForTests`), and add the two interval constants next to the other constants:
  ```ts
  // add near the other constants:
  const PERIODIC_INTERVAL_MS = 30_000;
  const HEALTH_INTERVAL_MS = 10_000;
  ```
  ```ts
  // --- triggers + lifecycle ---
  let periodicTimer: ReturnType<typeof setInterval> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let focusUnlisten: (() => void) | null = null;
  let engineStarted = false;

  async function pollHealth(): Promise<void> {
    const wasOnline = useSyncStore.getState().online;
    const online = await healthPing();
    useSyncStore.getState().setOnline(online);
    if (!wasOnline && online) {
      void requestSync('reconnect');
      void maybeRefreshCatalog(true).catch(() => undefined);
    }
  }

  function onOsOnline(): void {
    void pollHealth(); // OS hint only; the health ping is authoritative.
  }
  function onOsOffline(): void {
    useSyncStore.getState().setOnline(false);
  }
  function onVisibility(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void pollHealth().then(() => void requestSync('focus'));
    }
  }

  async function installFocusListener(): Promise<void> {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      focusUnlisten = await getCurrentWindow().onFocusChanged(
        ({ payload: focused }: { payload: boolean }) => {
          if (focused) void pollHealth().then(() => void requestSync('focus'));
        },
      );
    } catch {
      // Not running inside Tauri (browser dev / vitest); window + visibility events cover focus.
    }
  }

  export function startSyncEngine(): void {
    if (engineStarted) return;
    engineStarted = true;
    periodicTimer = setInterval(() => {
      if (useSyncStore.getState().unsyncedCount > 0) void requestSync('periodic');
    }, PERIODIC_INTERVAL_MS);
    healthTimer = setInterval(() => void pollHealth(), HEALTH_INTERVAL_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOsOnline);
      window.addEventListener('offline', onOsOffline);
      window.addEventListener('visibilitychange', onVisibility);
    }
    void installFocusListener();
    void refreshCounts();
    // Contract §5: hydrate the stale-catalog chip after a cold start (e.g. a week offline) from
    // persisted meta, so pos-ui reads it from the store without forcing a fresh in-session pull.
    void getMeta('last_catalog_pull_at').then((last) => {
      if (last) useSyncStore.getState().patch({ catalogRefreshedAt: last });
    });
    void pollHealth();
  }

  export function stopSyncEngine(): void {
    if (!engineStarted) return;
    engineStarted = false;
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOsOnline);
      window.removeEventListener('offline', onOsOffline);
      window.removeEventListener('visibilitychange', onVisibility);
    }
    if (focusUnlisten) {
      focusUnlisten();
      focusUnlisten = null;
    }
  }
  ```
  Also extend `__resetEngineForTests` to reset the lifecycle flag:
  ```ts
  export function __resetEngineForTests(): void {
    inFlight = null;
    rerunRequested = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    engineStarted = false;
  }
  ```

- [ ] **Run it and see it PASS.** Command: `npx vitest run src/lib/__tests__/sync-engine.test.ts`. Expected: all engine tests passing.

- [ ] **Run the full cashier suite.** Command (from `sellary-cashier/`): `npm test`. Expected: all suites green.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/lib/sync-engine.ts sellary-cashier/src/lib/__tests__/sync-engine.test.ts
  git commit -m "feat(cashier): wire sync-engine triggers (periodic, health poll, reconnect, focus) and lifecycle"
  ```

---

## Task 7: Integrate the engine into the UI (build-green wiring)

Wires the engine lifecycle into `CashierShell` and the sync-status controls into `SettingsPage`, removing the last references to the deleted `syncPendingSales`. **`POSPage.tsx` is NOT touched here** — per contract §3 the pos-ui plan owns POSPage (full rewrite). sync-engine only *exposes* the engine API (`requestSync`, `startSyncEngine`/`stopSyncEngine`, and `sync-store`); pos-ui consumes them (it wires `requestSync('post-sale')` after a local sale and renders the `Не отправлено: N` header badge from `useSyncStore`). Keep edits surgical — the full POS/History visual redesign is owned by the `pos-ui` / `history-ui` plans.

**Files:**
- Modify: `sellary-cashier/src/pages/CashierShell.tsx` (add exactly ONE engine start/stop effect, layered **after** offline-auth's version)
- Modify: `sellary-cashier/src/pages/SettingsPage.tsx` (additive sync-status section only — never a full-file replace)

Steps:

- [ ] **Start the engine on authenticated mount.** In `sellary-cashier/src/pages/CashierShell.tsx` — which **offline-auth owns and has already refactored for auth/PIN gating** — add the import and ONE lifecycle effect on top of offline-auth's version, at the equivalent post-refactor spot. Add after the existing imports:
  ```ts
  import { startSyncEngine, stopSyncEngine } from '../lib/sync-engine';
  ```
  Then add this effect inside `CashierShell`, after offline-auth's existing authentication effect (use offline-auth's authenticated-session predicate — shown here as `isAuthenticated`):
  ```ts
  useEffect(() => {
    if (!isAuthenticated) return;
    startSyncEngine();
    return () => stopSyncEngine();
  }, [isAuthenticated]);
  ```

- [ ] **Expose the engine API for pos-ui (no POSPage edit here).** Confirm `requestSync`, `startSyncEngine`, `stopSyncEngine`, `syncNow`, `refreshCatalog` are exported from `sellary-cashier/src/lib/sync-engine.ts` and `useSyncStore` from `sellary-cashier/src/lib/sync-store.ts`. pos-ui (contract §3) imports these directly: it fires `void requestSync('post-sale')` after the local sale write in its rewritten `handleCompleteSale`, and subscribes `const unsyncedCount = useSyncStore((s) => s.unsyncedCount)` for the `Не отправлено: N` badge. **Do not edit POSPage.tsx in this plan.**

- [ ] **Rewire SettingsPage to the engine + store (additive append).** In `sellary-cashier/src/pages/SettingsPage.tsx` — append the sync-status section; do not replace the file:
  - Remove `import { getPendingSales } from '../lib/db';` and `import { syncPendingSales } from '../lib/sync-service';`; add:
    ```ts
    import { useSyncStore } from '../lib/sync-store';
    ```
  - Replace `pendingCount` local state and its `getPendingSales(...)` reads with `const unsyncedCount = useSyncStore((s) => s.unsyncedCount);` and the `syncNow` action:
    ```ts
    const syncNow = useSyncStore((s) => s.syncNow);
    ```
  - Replace the `handleSync` body with:
    ```ts
    const handleSync = async () => {
      setSyncing(true);
      setMessage('');
      try {
        await syncNow();
        setMessage('Синхронизация запущена.');
      } catch (e: unknown) {
        setMessage(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        setSyncing(false);
      }
    };
    ```
  - Replace the `Pending sales: {pendingCount}` text with `Не отправлено: {unsyncedCount}`.

- [ ] **Verify the build compiles.** Command (from `sellary-cashier/`): `npx tsc --noEmit`. Expected: no type errors, and in particular no `Cannot find name 'syncPendingSales'` or unused-import errors in `CashierShell.tsx` / `SettingsPage.tsx`. (POSPage is not compiled-green by this plan — pos-ui, which merges after sync-engine, owns and rewrites it; the sync API surface exported here is what pos-ui depends on.)

- [ ] **Run the full cashier suite.** Command (from `sellary-cashier/`): `npm test`. Expected: all suites green.

- [ ] **Manual gate (documented, not automated).** The desktop build cannot be exercised in CI/vitest. After merge (with pos-ui merged on top), run `npm run tauri:dev` from `sellary-cashier/` and confirm: (a) the engine starts once CashierShell reaches an authenticated session and stops on logout; (b) completing a sale returns instantly and a background pass fires (`requestSync('post-sale')`, wired by pos-ui); (c) toggling the network flips the online dot within ~10s and triggers a reconnect pass + forced catalog pull; (d) an oversold offline sale surfaces the amber перерасход toast on sync.

- [ ] **Commit.**
  ```
  git add sellary-cashier/src/pages/CashierShell.tsx sellary-cashier/src/pages/SettingsPage.tsx
  git commit -m "feat(cashier): start the sync engine from CashierShell and drive Settings sync from the store"
  ```

---

## Done criteria

- `sync-store.ts` (incl. `lastWarningCount`, `hasRepeatedFailures`), `sync-engine.ts` created; `sync-service.ts` reduced to `pushOnce`/`pullCatalog` with no module `isSyncing` and no `syncPendingSales`. `pullCatalog` forwards RAW `bootstrap.products` to `upsertProducts` (contract §4.1 — no double-subtraction).
- `npm test` (from `sellary-cashier/`) green across `sync-store.test.ts`, `sync-service.test.ts`, `sync-engine.test.ts`, and the existing `auth-store.test.ts`.
- `npx tsc --noEmit` green for `CashierShell.tsx` / `SettingsPage.tsx` (no dangling references to the deleted helper). POSPage is owned/rewritten by pos-ui.
- The engine owns the single mutex; all triggers funnel through `requestSync(reason, opts?)`; `force:true` re-sends permanent-failed rows via `getSendableSales(now, { includePermanent:true })`; transient failures back off and self-retry; permanent failures land in the needs-attention count without auto-retry; oversell/mixed-batch outcomes raise toasts and set `lastWarningCount`; `catalogRefreshedAt` hydrates from meta on init; stock reconciliation `local = server − Σ unsynced` lives **solely** in `upsertProducts`.
