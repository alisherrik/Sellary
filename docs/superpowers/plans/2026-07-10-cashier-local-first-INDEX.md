# Cashier Local-First — Plan Index, Merge Order & Cross-Plan Contract

> **Authoritative reconciliation doc.** Where an individual plan disagrees with this file, **this file wins.** It fixes the 7 release-blocking composition bugs the cross-plan consistency review found (the six plans were authored in parallel and each passes its own tests in isolation, but did not compose). Read this before executing any plan.

**Spec:** [`docs/superpowers/specs/2026-07-10-cashier-local-first-design.md`](../specs/2026-07-10-cashier-local-first-design.md)

---

## 1. The six plans

| # | Plan | Package | Tasks | Depends on |
|---|---|---|---|---|
| 1 | [Backend additive foundation](2026-07-10-cashier-backend-foundation.md) | backend | 10 | — |
| 2 | [Cashier local data model + stock](2026-07-10-cashier-local-data-model.md) | cashier | 8 | — |
| 3 | [Offline auth (cashier)](2026-07-10-cashier-offline-auth.md) | cashier | 9 | 1, 2 |
| 4 | [Background sync engine](2026-07-10-cashier-sync-engine.md) | cashier | 7 | 2 |
| 5 | [POS "Kassa" UI](2026-07-10-cashier-pos-kassa-ui.md) | cashier | 14 | 2, 4 |
| 6 | [Sales History UI](2026-07-10-cashier-sales-history-ui.md) | cashier | 13 | 2 |

## 2. Pinned merge order (REQUIRED)

`POSPage.tsx`, `CashierShell.tsx`, `SettingsPage.tsx`, and `App.tsx` are touched by multiple plans, so the merge order is **not** free:

```
1) data-model  →  2) backend  →  3) offline-auth  →  4) sync-engine  →  5) pos-ui  →  6) history-ui
```

data-model and backend are independent (different packages) and may proceed in parallel; everything else follows the chain because of shared-file ownership below.

## 3. Single-owner file ownership (resolves the multiply-owned-file conflicts)

| File | Sole owner | Rule for other plans |
|---|---|---|
| `src/App.tsx` | **offline-auth** | Final version has `<Toaster/>` (react-hot-toast) + routes `/login`, `/cashier`, `/pin-setup`, `/pin-unlock`, `/history`, `/settings`, catch-all→`/login`. **pos-ui and history-ui MUST NOT edit App.tsx** — their routes already exist; they add nav links inside their own screens only. |
| `src/pages/POSPage.tsx` | **pos-ui** (full rewrite) | **sync-engine MUST NOT rewrite POSPage** — it only exposes the engine API (`requestSync`, `sync-store`). pos-ui wires `requestSync('post-sale')` + the `Не отправлено: N` header badge + the `История` nav link. history-ui MUST NOT edit POSPage. |
| `src/pages/CashierShell.tsx` | **offline-auth** (auth/PIN gating) | sync-engine adds exactly ONE engine start/stop `useEffect`, applied **after** offline-auth's version at the equivalent post-refactor spot. |
| `src/pages/SettingsPage.tsx` | shared, additive only | sync-engine owns the sync-status section; history-ui **appends** `NeedsAttentionList` below it. Additive appends, never full-file replaces. |
| `src/lib/format.ts` | **pos-ui** | history-ui imports `formatCurrency` from it (identical signature). |
| deps `@heroicons/react`, `@fontsource/inter`, `react-hot-toast` | **pos-ui** installs once | history-ui assumes they exist. |

## 4. Canonical shared contract (data-model owns `db.ts`; all others consume EXACTLY these)

### 4.1 Stock reconcile — ONE subtractor (fixes the double-subtraction release bug)
- `getUnsyncedBaseQtyByProduct(): Map<number,number>` = Σ base qty over sales with `sync_status ∈ {pending, syncing, failed}` (ALL unsynced, incl. permanent).
- `upsertProducts(products: LocalProduct[])` is the **SOLE owner** of `local_stock = server_stock − getUnsyncedBaseQtyByProduct()`.
- **sync-engine `pullCatalog` MUST pass RAW `bootstrap.products` to `upsertProducts` — it must NOT pre-subtract.** (As authored, sync-engine subtracted once and `upsertProducts` subtracted again → local = server − 2×Σunsynced, halving a week of offline stock on every reconnect.)

### 4.2 Resend / force (fixes dead "Повторить" on permanent-failed sales)
- `getSendableSales(nowIso: string, opts?: { includePermanent?: boolean }): SaleWithItems[]`
  - default: `pending` OR (`failed` AND `error_kind='transient'` AND `next_attempt_at<=now`)
  - `includePermanent:true`: ALSO include `failed` AND `error_kind='permanent'`.
- `requestSync(reason: SyncReason, opts?: { force?: boolean }): Promise<SyncPassResult>` — `force:true` ⇒ `runPass` calls `getSendableSales(now, { includePermanent:true })`. `SyncReason` union includes `'manual'`.
- History `SaleDetailPanel` + `NeedsAttentionList` retry via `requestSync('manual', { force:true })`.

### 4.3 Acknowledge (needs a new column)
- Add `acknowledged INTEGER NOT NULL DEFAULT 0` to the `sales` DDL in `002_local_first.sql`.
- `acknowledgeSale(saleId: number): Promise<void>` → `UPDATE sales SET acknowledged=1`.
- `getNeedsAttentionCount()` = COUNT `sync_status='failed' AND error_kind='permanent' AND acknowledged=0`.
- Acknowledged permanent sales drop from the count but the row is kept; they never block logout.

### 4.4 Counts
- `getUnsyncedCount()` = `pending` + `syncing` + (`failed` & `transient`). **Excludes permanent & acknowledged.** Drives the badge + the hard logout gate.

### 4.5 History filter (fixes the empty-History type mismatch)
Canonical exported type — history-ui MUST use this name and these fields:
```ts
type HistoryFilter = {
  search?: string;
  paymentMethod?: string;                 // falsy OR 'all' ⇒ NO filter
  syncFilter?: 'all' | 'synced' | 'unsynced' | 'attention';
  dateFrom?: string;                       // NOT startDate
  dateTo?: string;                         // NOT endDate
  limit: number;
  offset: number;
};
```
`buildHistoryWhere`: `paymentMethod` falsy or `'all'` → no payment filter; dates read from `dateFrom`/`dateTo`. history-ui maps its date pickers to `dateFrom`/`dateTo` and sends `paymentMethod` omitted for the "Все" tab.

### 4.6 Device identity bind (fixes NULL-persisted identity)
Canonical shape — offline-auth's `bindDeviceIdentity` call MUST pass exactly this (snake_case, 7 fields):
```ts
type DeviceIdentityInput = {
  user_id: number; username: string;
  company_id: number; company_name: string; user_role: string;
  device_token_expires_at: string | null; last_online_auth_at: string;
};
```

### 4.7 Device refresh response (fixes undefined expiry mirror)
- Backend `DeviceRefreshResponse = { access_token, token_type, expires_at }`.
- Cashier (offline-auth `api.ts` + `auth-store`) reads **`res.expires_at`** (NOT `device_token_expires_at`) and stores it as the device-token expiry mirror.

## 5. Coverage additions (spec §4.7, §5.4, §9 gaps the review found)
- **sync-engine `runPass`**: after reconcile, collect `SyncSaleResult.warnings`; oversell warnings → amber toast `Синхронизировано, перерасход: N позиций`; mixed batch → toast `Отправлено N · требует внимания M`. `sync-store` exposes `lastWarningCount`.
- **sync-engine init**: load `catalogRefreshedAt` from `meta('last_catalog_pull_at')` into `sync-store` on startup, so the stale-catalog chip shows after a cold start following a week offline (pos-ui reads it from the store, not a fresh in-session pull).
- **Repeated transient failures** (`retry_count ≥ 8`, spec §4.7): `sync-store` exposes `hasRepeatedFailures`; history-ui shows a non-blocking "повторные сбои" chip. Auto-retry continues.

## 6. Genuine open decisions for the user (business, not mechanical)
These are NOT resolved by the contract above — they need a human call before or during execution:
1. **Device provisioning authority** — may a **cashier-role** token self-register the device on first run (spec/plan default: yes), or admin/manager-only?
2. **PIN policy** — 4-digit (default) vs 6-digit; lockout curve (default: 5 attempts → 30s×2ⁿ, cap 15 min).
3. **`DEVICE_TOKEN_EXPIRE_DAYS = 180`** + sliding renewal — confirm.
4. **Oversell valuation** — value the offline-oversold shortfall at running `cost_price` (default) or 0.
5. **Negative-stock web audit owner** — who verifies web product lists/dashboards/reports tolerate negative stock before C1 ships.
6. **Reprint target** — webview `window.print()` (default) vs a real thermal/ESC-POS Tauri command.
7. **History retention** — keep all synced local sales forever (default) or prune synced rows older than N days.

## 7. Verification gates carried from the plans
- Backend: `python -m compileall …` (CI) + full pytest incl. the online-strictness regression; the Alembic upgrade/downgrade round-trip is a **manual** pre-merge gate (needs Postgres). The single migration `c3d4e5f6a7b8` chains off `b2c3d4e5f6a7`; **bump `railway.toml` + `sellary-backend/railway.json` pins in the same commit** (CI cannot catch a missed pin).
- Cashier: `npm test` (vitest); data-model uses an in-memory `node:sqlite` fake behind `@tauri-apps/plugin-sql` to exercise real SQL; the Rust argon2 command build is a manual `npm run tauri:dev` gate on `windows-latest`.
- Stale docs fixed with this work: CLAUDE.md "migrations are gitignored" (they are **tracked**) and "online overselling allowed" (online now **rejects**; only sync tolerates); AGENTS.md may repeat the latter — follow-up.
