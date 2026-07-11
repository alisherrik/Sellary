# Sellary Cashier — Offline Credit (В долг) + Offline Customers: Design Spec

> **Phase 2** of the local-first cashier. Builds on the merged Phase 1 (offline sales, sync engine, offline auth). Enables selling on credit and managing customers **fully offline**, mirroring the proven Phase-1 sales/stock pattern (local-first + outbox + sync with client-ID mapping + reconciliation).

**Spec 1 (foundation):** [`2026-07-10-cashier-local-first-design.md`](2026-07-10-cashier-local-first-design.md). **Reconciliation/merge contract:** [`../plans/2026-07-10-cashier-local-first-INDEX.md`](../plans/2026-07-10-cashier-local-first-INDEX.md).

## 1. Overview & decisions (confirmed with the user)

Make **credit sales (В долг)** and **customers** work fully offline on the Tauri cashier. The web + backend stay online and unchanged; every backend change is **additive**.

| Decision | Choice |
|---|---|
| Offline customer creation | **Full** — create new customers offline (`client_customer_id` → `server_id` mapping, dedup by phone) AND select existing |
| Offline debt collection | **Both offline** — sell on credit AND accept debt repayments offline |
| Payment exceeds server debt on sync (drift) | **Cap-to-balance + warning** — apply `min(amount, server_balance)`, surface the overpayment as a warning |
| Credit limit | **None** (parity — the system has no credit limit today; YAGNI) |
| Offline returns | **Out of scope** — stays online-only |

### Key facts the design relies on (verified)
- **Debt balance is DERIVED, never stored** — `SUM(amount)` over `customer_ledger_entries` (`credit_sale` = +total, `payment`/`return_adjustment`/`cancel_adjustment` = −). Service: `services/customer_ledger_service.py`.
- The backend **credit engine is sound and reusable**: `record_credit_sale(sale, cashier_id, initial_payment_amount, initial_payment_method)` and `record_payment(...)` (FIFO across open credit sales). The sync path just needs to **route into them** instead of blocking credit.
- Customer: `models/customer.py` — int PK, `company_id`, `name`/`phone`/`email`/`address`/`description`, unique `(company_id, phone)`, **no `updated_at`**, **no credit fields**, **no `client_customer_id`**. Create (`POST /customers`) has **no idempotency** (dedup only via phone uniqueness).
- Credit sale rules (`SaleService.create` + `record_credit_sale`): customer **required**; `paid_amount` (initial) must be `<= total`; `initial_payment_method` ∈ {cash,card,mobile} and required iff `paid_amount>0`; when initial payment is 0, both fields omitted. `payment_status` ∈ {unpaid, partial, settled, paid}.
- Debt payment: `POST /customers/{id}/payments` (customer-level, idempotent), `amount>0`, `amount <= balance` ("Payment exceeds customer debt"), method ∈ {cash,card,mobile}. FIFO-applied server-side.
- **Sync gaps to fill (all additive):** (1) `sync_service._validate_sale` rejects `credit` + `_create_sale` hardcodes `customer_id=None`; (2) `SyncSaleCreate` has no customer/credit fields; (3) `bootstrap` ships no customers; (4) no `client_customer_id` + no idempotency on customer create.
- The credit DB objects (`customer_ledger_entries`, `sales.payment_status`, enum `credit`) are created by a **startup DDL shim** `services/customer_credit_schema.py` (`ensure_customer_credit_schema`, Postgres-only), NOT Alembic. The only NEW schema this feature needs (`customers.client_customer_id`) goes in a **proper Alembic migration** (chained off the Phase-1 head `c3d4e5f6a7b8`).

---

## 2. Local SQLite schema — migration `003_offline_credit.sql` (additive DDL only)

### 2.1 `customers` (new)
```sql
CREATE TABLE IF NOT EXISTS customers (
    client_customer_id  TEXT PRIMARY KEY,          -- always present (uuid); local identity
    server_id           INTEGER,                    -- backend customers.id, filled after sync (NULL until)
    name                TEXT NOT NULL,
    phone               TEXT,                        -- dedup key on server (company_id, phone)
    email               TEXT,
    address             TEXT,
    description         TEXT,
    balance             REAL NOT NULL DEFAULT 0,     -- server-derived debt at last pull (NOT incl. local unsynced)
    is_active           INTEGER NOT NULL DEFAULT 1,
    sync_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (sync_status IN ('pending','syncing','synced','failed')),
    error_kind          TEXT, next_attempt_at TEXT, first_failed_at TEXT, last_error TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    created_at_client   TEXT NOT NULL,
    synced_at           TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_server_id ON customers(server_id) WHERE server_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sync ON customers(sync_status);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
```
Bootstrap-pulled (existing) customers land here with a synthesized `client_customer_id` (or reuse `srv:<id>`), `server_id` set, `sync_status='synced'`, `balance` from the server.

### 2.2 `customer_payments` (new outbox)
```sql
CREATE TABLE IF NOT EXISTS customer_payments (
    client_payment_id   TEXT PRIMARY KEY,
    idempotency_key     TEXT NOT NULL,
    customer_client_id  TEXT NOT NULL,               -- references customers.client_customer_id
    amount              REAL NOT NULL,
    payment_method      TEXT NOT NULL,               -- 'cash'|'card'|'mobile'
    description         TEXT,
    applied_amount      REAL,                         -- filled from server result (may be < amount if capped)
    server_customer_id  INTEGER,
    sync_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (sync_status IN ('pending','syncing','synced','failed')),
    error_kind TEXT, next_attempt_at TEXT, first_failed_at TEXT, last_error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at_client   TEXT NOT NULL,
    synced_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_payments_sync ON customer_payments(sync_status);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_client_id);
```

### 2.3 `sales` — additive columns (ALTER)
```sql
ALTER TABLE sales ADD COLUMN customer_client_id  TEXT;     -- set for credit sales
ALTER TABLE sales ADD COLUMN initial_payment_method TEXT;  -- 'cash'|'card'|'mobile' when initial payment > 0
```
`payment_method` (already TEXT, no CHECK) now also accepts `'credit'`. `paid_amount` (exists) holds the initial payment. A credit sale's remaining = `total_amount − paid_amount` at creation (server recomputes authoritatively).

> Note: SQLite `ALTER TABLE ADD COLUMN` is additive and safe; migration `003` is registered as `Migration { version: 3, ... }` in `src-tauri/src/lib.rs` after v2.

### 2.4 Local debt derivation (no local ledger table)
`localBalance(customer)` = `customers.balance` (server value at last pull) `+ Σ remaining of that customer's unsynced credit sales` `− Σ that customer's unsynced payments (amount)`. Computed in SQL on read. Mirrors the stock reconcile: **server value + local-unsynced delta**.

---

## 3. Backend additive changes

### C1 — `customers.client_customer_id` column (MIGRATION REQUIRED)
`models/customer.py`: `client_customer_id = Column(String(64), nullable=True, index=True)`. New Alembic migration `down_revision = "c3d4e5f6a7b8"` adding the column + a **partial unique index** `uq_customers_company_client_customer_id ON customers(company_id, client_customer_id) WHERE client_customer_id IS NOT NULL`. Bump the railway pins (`railway.toml` + `sellary-backend/railway.json`) to the new rev in the same PR. **Proof:** nullable column + partial index over non-null rows; existing customers (NULL) unaffected; web create leaves it NULL.

### C2 — `POST /api/sync/customers` (batch upsert; MIGRATION-free beyond C1)
Router `api/sync.py` (or a new `api/sync_customers.py`), auth via `get_auth_context`. Request `{ customers: [SyncCustomerCreate] }` where `SyncCustomerCreate = {client_customer_id, name, phone?, email?, address?, description?}`. Per customer, resolve in order:
1. existing row by `(company_id, client_customer_id)` → update (idempotent replay);
2. else existing **active** row by `(company_id, phone)` (phone present) → **merge**: attach `client_customer_id` to that row (dedup with web/other-device creation);
3. else create a new customer with `client_customer_id` set.
Returns `{ results: [{client_customer_id, status: 'synced'|'duplicate'|'failed', server_id, error?}] }`. New service `CustomerSyncService`; reuse `CustomerRepository`.

### C3 — `SyncBootstrapResponse.customers` (additive, no migration)
Add `customers: list[SyncCustomerItem]` to the bootstrap response — `{id, client_customer_id, name, phone, email, address, description, balance, is_active}` where `balance = CustomerLedgerService.get_customer_balance` per active customer. **Proof:** new defaulted field on a response only the cashier consumes.

### C4 — credit + customer in `/api/sync/sales` (additive)
`SyncSaleCreate` gains `client_customer_id: str | None` and `initial_payment_method: str | None` (it already has `paid_amount`). `sync_service._validate_sale`: allow `payment_method == 'credit'` **iff** `client_customer_id` is present; keep cash/card/mobile as-is. `_create_sale`: when credit, resolve the customer by `(company_id, client_customer_id)` → its `server_id` (must exist — customers are pushed first in the same pass; if missing, return `failed` so it retries after the customer syncs), set `Sale.customer_id`, `payment_status`, and call `record_credit_sale(sale, cashier_id, initial_payment_amount=paid_amount, initial_payment_method=...)`. Oversell tolerance unchanged. **Proof:** new optional fields; non-credit path byte-for-byte unchanged; a regression test asserts online `POST /api/sales` + cash/card/mobile sync are unaffected.

### C5 — `POST /api/sync/payments` (batch; cap-to-balance + warning)
Request `{ payments: [SyncPaymentCreate] }` where `SyncPaymentCreate = {client_payment_id, idempotency_key, client_customer_id, amount, payment_method, description?}`. Per payment: resolve customer by `client_customer_id`; if `amount > current_balance`, **cap** to `applied = current_balance` and emit a `SyncWarning(type='overpayment', requested, applied)`; call `record_payment(customer_id, applied, method, description)` (a new `allow_cap=True` path OR pre-cap before calling, since `record_payment` itself rejects `amount>balance`). If `current_balance <= 0`, skip with a warning (nothing to apply). Idempotent per `client_payment_id`/`idempotency_key`. Returns `{ results: [{client_payment_id, status, applied_amount, warnings?, error?}] }`. Reuse the existing per-customer idempotency plumbing.

### Ledger reuse
No changes to `record_credit_sale` / `_customer_balance` / FIFO logic. C5's only new behavior is the **cap** (compute balance, clamp, then call the existing method with the clamped amount) — the existing "Payment exceeds customer debt" guard is thus never tripped by the sync path.

---

## 4. Sync flow (one `runPass`, ordered) + reconciliation

Extend the Phase-1 sync engine. Within a single pass, **push in dependency order** so references resolve:
```
1) push customers   (POST /api/sync/customers)  → apply {client_customer_id → server_id} to local customers.server_id, mark synced
2) push credit sales (already via POST /api/sync/sales, now carrying client_customer_id)
3) push debt payments (POST /api/sync/payments)  → store applied_amount + warnings
4) pull catalog + customers (bootstrap)          → reconcile balances
```
Steps 2–3 include the existing cash/card/mobile sales push (unchanged). `getSendableSales` already covers credit sales (they're just `sales` rows). New sendable queries: `getSendableCustomers`, `getSendablePayments` (same pending/transient-failed/force-permanent semantics + backoff as sales).

**Debt reconciliation (on customer pull):** for each pulled customer, `customers.balance = server_balance` (raw). The **displayed** debt is always recomputed as `balance + Σ unsynced credit remaining − Σ unsynced payments` (§2.4) — so pulling raw server balances is correct and idempotent (mirrors the stock `local = server − Σunsynced` rule; sole "subtractor" is the read-time derivation, never a stored double-count).

**Warnings surfaced:** overpayment/capped-payment warnings from C5 and oversell warnings from C4 → amber toasts + `sync-store.lastWarningCount` (Phase-1 mechanism).

---

## 5. Cashier UI

### 5.1 PaymentModal — enable «В долг» (credit)
Un-disable the credit tab (Phase 1 left it disabled with "internet kerak"). Add, matching the web POS credit panel:
- **Customer picker** from local `customers` (name + phone + red debt if `localBalance>0`), with a search box.
- **Quick-create** (name + phone required, optional description) → `insertCustomer` locally (client_customer_id, sync_status='pending'); the new customer is immediately selectable offline.
- **«Оплачено сейчас»** (initial payment) input + method (cash/card/mobile) reusing web's `calculateCreditInitialPayment` (copy the helper into `posPricing.ts`); **«Останется долг»** = remaining.
- Submit gated on: customer selected + initial payment valid (`<= total`).
On complete: `insertSale` with `payment_method='credit'`, `customer_client_id`, `paid_amount`, `initial_payment_method`; the credit sale enters the outbox like any sale. Non-credit paths unchanged.

### 5.2 Customers screen (new, mirrors web `/customers`)
New route `/customers` + nav link (in the POS header, like «История»). Components (small, under `src/pages/customers/` + `src/components/customers/`):
- **List** with debt filter tabs (Все / Есть долг / Нет долга), search, each card showing name/phone + local debt (red if >0) + a sync badge for unsynced customers.
- **Detail**: current local debt, a **local ledger view** (unsynced credit sales + payments) merged with pulled info, and a **«Принять оплату долга»** action → `insertCustomerPayment` locally (goes to the `customer_payments` outbox), disabled when local debt ≤ 0.
- Reuse `formatCurrency`, `SyncStatusBadge`.

### 5.3 History
Credit sales already render (Phase 1). Add: the «В долг» PaymentChip variant + a compact credit/debt summary (customer name + сумма/оплачено/осталось, derived locally) in `SaleDetailPanel`. No debt-payment action here (it lives in the Customers screen) to keep History read-focused.

### 5.4 DAO additions (`db.ts`)
`insertCustomer`, `getCustomers(filter)`, `getCustomerByClientId`, `upsertServerCustomers` (bootstrap), `getCustomerLocalBalance`/`getCustomersWithLocalBalance`, `insertCustomerPayment`, `getCustomerLedgerLocal`; sync-worker DAOs `getSendableCustomers`, `getSendablePayments`, `mark*` for both, `applyCustomerIdMap(results)`, `applyPaymentResults(results)`; reconcile `reconcileCustomerBalances(serverCustomers)`. Credit-sale insert reuses `insertSale` with the new fields.

---

## 6. Backward-compatibility & migration discipline
- **All backend changes additive:** new nullable `customers.client_customer_id`, new routers (`/api/sync/customers`, `/api/sync/payments`), new optional `SyncSaleCreate` fields, new bootstrap `customers` field. No existing endpoint/column/enum changed. Web credit/customer flows untouched (they use `/api/sales`, `/api/customers`, `/customers/{id}/payments`).
- **One new Alembic migration** off `c3d4e5f6a7b8` (the Phase-1 head) → exactly one new head; bump `railway.toml` + `sellary-backend/railway.json` pins in the same commit. No `alembic merge`.
- **Local migration `003`** strictly additive (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`), forward-only alongside `001`/`002`.
- **Credit-sale sync divergence documented:** offline credit sales sync as historical facts; oversell tolerance already applies. Debt payments cap-to-balance (never exceed server debt).

## 7. Non-goals / YAGNI
- No offline returns/void (online-only). No credit limit (parity). No local `customer_ledger` mirror table (debt derived on read). No multi-device customer conflict beyond phone-dedup merge (single device). No editing existing customers offline in Phase 2 (create + select + pay only).

## 8. Testing
- **Backend (pytest):** `/api/sync/customers` upsert/dedup-by-phone/merge/idempotent; bootstrap returns customers + balances; `/api/sync/sales` credit routes to `record_credit_sale` (ledger entries + payment_status), resolves client_customer_id, **regression: cash/card/mobile + online `/api/sales` unchanged**; `/api/sync/payments` cap-to-balance + warning + idempotent; one migration upgrade/downgrade round-trip + single head.
- **Cashier (vitest, node:sqlite harness):** migration 003 schema; insertCustomer + client-id mapping; local debt derivation = server + Σcredit − Σpayments; reconcile idempotent; credit-sale insert; payment outbox; sync ordering (customers→sales→payments) + id-map application; cap surfaced. RTL for the credit PaymentModal + Customers screen.
- CI: cashier Node 24 (node:sqlite); backend `compileall`.

## 9. Open questions
1. **Bootstrap customer volume** — with many customers, bootstrap grows. Phase-2 pulls all active customers (fine for the <1000-scale assumption); a `since`/paged customer pull is a future optimization (non-goal now).
2. **`client_customer_id` for bootstrap-origin customers** — synthesize `srv:<id>` so every local row has a stable PK, or generate a uuid and backfill `server_id`. Spec assumes `srv:<id>` for pulled rows (never pushed), fresh uuid for offline-created.
3. **Overpayment display** — when a payment is capped, show the capped `applied_amount` + an amber "переплата не применена" note in the Customers ledger. Confirm copy at implementation.
