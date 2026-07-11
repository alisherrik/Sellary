# Cashier Offline Credit (Phase 2) — Plan Index, Merge Order & Contract

> **Authoritative reconciliation doc.** Where a plan disagrees, this file wins. It fixes the 9 composition breaks the cross-plan review found (all at the data-model DAO boundary + one credit-sync ownership decision). Read before executing.

**Spec:** [`../specs/2026-07-11-cashier-offline-credit-design.md`](../specs/2026-07-11-cashier-offline-credit-design.md)

## Plans & merge order (REQUIRED)
```
data-model → backend → credit-sync → credit-pos → customers-ui
```
data-model and backend are independent roots (different packages). `POSPage.tsx` is edited additively by BOTH credit-pos (payment/credit state) and customers-ui (one «Клиенты» header button) — whichever lands second MERGES, does not replace. `App.tsx` gets exactly one added `<Route path="/customers">` line (customers-ui) — never a rewrite (offline-auth owns it).

| Plan | File | Tasks |
|---|---|---|
| data-model | [2026-07-11-cashier-credit-data-model.md](2026-07-11-cashier-credit-data-model.md) | 8 |
| backend | [2026-07-11-cashier-credit-backend.md](2026-07-11-cashier-credit-backend.md) | 5 |
| credit-sync | [2026-07-11-cashier-credit-sync.md](2026-07-11-cashier-credit-sync.md) | 3 |
| credit-pos | [2026-07-11-cashier-credit-pos-ui.md](2026-07-11-cashier-credit-pos-ui.md) | 8 |
| customers-ui | [2026-07-11-cashier-customers-ui.md](2026-07-11-cashier-customers-ui.md) | 6 |

## Canonical contract (data-model owns `db.ts`; others consume EXACTLY these)

### C-1 Customer balance type
`export type CustomerWithBalance = { client_customer_id: string; server_id: number | null; name: string; phone: string | null; email: string | null; address: string | null; description: string | null; local_balance: number; is_active: number; sync_status: string; error_kind: string | null; }`. data-model exports **`CustomerWithBalance`** (not `LocalCustomerWithBalance`). All UI plans import `CustomerWithBalance`.

### C-2 insertCustomer (db.ts generates id + timestamp)
`insertCustomer(input: { name: string; phone?: string; email?: string; address?: string; description?: string }): Promise<{ clientCustomerId: string }>`. db.ts generates `client_customer_id` (uuid) + `created_at_client` internally; sync_status='pending'. Returns `{ clientCustomerId }`.

### C-3 insertCustomerPayment (db.ts generates ids + timestamp)
`insertCustomerPayment(input: { customer_client_id: string; amount: number; payment_method: string; description?: string }): Promise<{ clientPaymentId: string }>`. db.ts generates `client_payment_id` (uuid) + `idempotency_key` (uuid) + `created_at_client` internally; sync_status='pending'.

### C-4 Local ledger shape
`export type LocalLedgerEntry = { ref_id: string; kind: 'credit_sale' | 'payment'; amount: number; /* SIGNED: credit_sale = +remaining, payment = −amount */ description: string | null; receipt_no: number | null; applied_amount: number | null; created_at_client: string; sync_status: string; error_kind: string | null; }`. `getCustomerLedgerLocal(clientCustomerId): Promise<LocalLedgerEntry[]>` — SQL selects `receipt_no` (from the credit sale) + `error_kind`; signs amounts; includes `applied_amount` for payments (null until synced/capped).

### C-5 Credit count DAOs (data-model adds)
`getUnsyncedCreditCount(): Promise<number>` = (pending+syncing+transient-failed) over `customers` + `customer_payments`. `getNeedsAttentionCreditCount(): Promise<number>` = permanent-failed over `customers` + `customer_payments`. credit-sync `refreshCounts` uses these; sync-store adds them to the badge/needs-attention totals.

### C-6 Failed-result ownership = the sync ENGINE (credit-sync), mirroring Phase-1 sales
`applyCustomerIdMap(results)` / `applyPaymentResults(results)` ONLY handle `synced`/`duplicate` (set `server_id` / `applied_amount`, mark synced). They do NOT touch `failed`. The credit-sync engine reconcile classifies per result: `synced`/`duplicate` → apply + mark synced; `failed` (business error) → `markCustomerPermanentFailure(id, err)` / `markPaymentPermanentFailure(id, err)`; transport throw / non-2xx → `markCustomerTransientFailure` / `markPaymentTransientFailure` (backoff). data-model provides all `mark*` DAOs (mirroring the sales worker).

### C-7 Sync-result types owned by `api.ts` (credit-sync)
api.ts is the sole definition site: `SyncCustomerResult = { client_customer_id: string; status: 'synced'|'duplicate'|'failed'; server_id?: number | null; error?: string | null }`; `SyncPaymentResult = { client_payment_id: string; status: 'synced'|'duplicate'|'failed'; applied_amount?: number | null; warnings?: SyncPaymentWarning[] | null; error?: string | null }`. data-model's `applyCustomerIdMap`/`applyPaymentResults` **import these types from `../api`** (type-only) and accept them as-is (no redefinition).

### C-8 Backend sends Decimal as JSON strings — api.ts coerces to number
The backend serializes `Decimal` as JSON strings ("30.00"). The cashier `api.ts` response parsers MUST coerce the NEW numeric fields to `number` via `Number(...)`: bootstrap customer `balance`, `SyncPaymentResult.applied_amount`, and `SyncPaymentWarning.requested`/`applied`. Downstream (`reconcileCustomerBalances`, `applyPaymentResults`, local-balance math) then work with real numbers.

### C-9 Widen SaleWithItems
data-model Task 2 must widen `SaleWithItems` (and `getSaleWithItems`) with `customer_client_id: string | null` + `initial_payment_method: string | null`, in addition to `LocalSale`/`RawSaleRow`/`NewSaleInput`. Consumed by credit-sync pushOnce + credit-pos SaleDetailPanel.

## Coverage additions
- **Overpayment/capped indicator (spec §9 Q3):** `customer_payments.applied_amount` (< amount when capped) flows into `LocalLedgerEntry.applied_amount`. customers-ui `CustomerDetail` shows an amber "переплата не применена (учтено N)" note on a synced payment whose `applied_amount < amount`. The immediate feedback is the credit-sync overpayment toast; this is the durable per-payment indicator.
- **Local debt includes permanent-failed rows (spec §2.4):** intended — a locally-recorded credit sale/payment that the server rejected still reflects in displayed debt until the operator resolves it via the needs-attention list. The `getNeedsAttentionCreditCount` badge surfaces it separately.

## Backend / migration discipline (unchanged from plan)
One Alembic migration `d4e5f6a7b8c9` off `c3d4e5f6a7b8` (customers.client_customer_id + partial unique index) + bump `railway.toml` (root) & `sellary-backend/railway.json` pins in the same commit. `SyncPaymentWarning` is a NEW backend model (keeps the product-shaped `SyncWarning` untouched). Local migration `003_offline_credit.sql` additive, registered as `Migration{version:3}` in lib.rs; `fakeDb.ts` execs 003.
