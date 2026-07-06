# Client Credit Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary credit-sale note with a real customer receivables ledger, customer debt payments, and UI for POS/sales/customers.

**Architecture:** Reuse existing customers and sales. Add an immutable `customer_ledger_entries` table and a small `CustomerLedgerService` that is the only writer for credit-sale, payment, return, and void debt events. The frontend keeps ordinary sales customerless, but requires selecting or creating a customer for `В долг`.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, PostgreSQL/SQLite tests, Next.js 14, React, TanStack Query, Vitest.

---

### Task 1: Backend debt schema and models

**Files:**
- Create: `sellary-backend/models/customer_ledger_entry.py`
- Create: `sellary-backend/services/customer_credit_schema.py`
- Modify: `sellary-backend/models/customer.py`
- Modify: `sellary-backend/models/sale.py`
- Modify: `sellary-backend/models/__init__.py`
- Modify: `sellary-backend/main.py`
- Modify: `sellary-backend/tests/conftest.py`

- [ ] **Step 1: Write the failing schema/model tests**

Create `sellary-backend/tests/unit/test_customer_ledger_service.py` with imports that expect `CustomerLedgerEntry`, `PaymentMethod.CREDIT`, `Sale.payment_status`, and `Customer.description` to exist.

- [ ] **Step 2: Run the failing test**

Run: `D:\Learning\Sellary\sellary-backend\.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py -v`

Expected: import/attribute failures for the new model/columns.

- [ ] **Step 3: Add the model and safe startup schema ensure**

Add `CustomerLedgerEntry` with `company_id`, `customer_id`, `sale_id`, `entry_type`, `amount`, `payment_method`, `description`, `created_by_user_id`, and `created_at`.

Add `Customer.description`, `PaymentMethod.CREDIT = "credit"`, and `Sale.payment_status = Column(String(20), nullable=False, default="paid")`.

Add a PostgreSQL-only `ensure_customer_credit_schema()` that runs:

```sql
ALTER TYPE paymentmethod ADD VALUE IF NOT EXISTS 'credit';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS description VARCHAR(500);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'paid';
CREATE TABLE IF NOT EXISTS customer_ledger_entries (...);
CREATE INDEX IF NOT EXISTS ix_customer_ledger_company_customer_created ON customer_ledger_entries(company_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_customer_ledger_company_sale ON customer_ledger_entries(company_id, sale_id);
```

Call it in `main.py` lifespan before normal startup work.

- [ ] **Step 4: Run the schema/model tests**

Run: `D:\Learning\Sellary\sellary-backend\.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py -v`

Expected: schema/model tests pass or fail only because service behavior is missing.

### Task 2: CustomerLedgerService behavior

**Files:**
- Create: `sellary-backend/services/customer_ledger_service.py`
- Create: `sellary-backend/schemas/customer_ledger.py`
- Modify: `sellary-backend/schemas/sale.py`
- Modify: `sellary-backend/schemas/customer.py`

- [ ] **Step 1: Write failing service tests**

Add tests for:

```python
def test_credit_sale_records_positive_customer_balance(...): ...
def test_customer_payment_reduces_balance_fifo(...): ...
def test_overpayment_is_rejected(...): ...
def test_return_adjustment_reduces_only_remaining_sale_debt(...): ...
```

- [ ] **Step 2: Run the failing tests**

Run: `D:\Learning\Sellary\sellary-backend\.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py -v`

Expected: service import/method failures.

- [ ] **Step 3: Implement the service**

Implement methods:

```python
record_credit_sale(sale, user_id)
record_payment(customer_id, amount, payment_method, user_id, description=None)
record_return_adjustment(sale, amount, user_id, description=None)
record_cancel_adjustment(sale, user_id, description=None)
get_customer_balance(customer_id)
get_customer_ledger(customer_id)
sale_credit_summary(sale)
```

`record_payment` splits payment entries across oldest unpaid credit sales by `created_at`, so sale-level debt status stays accurate.

- [ ] **Step 4: Run the service tests**

Run: `D:\Learning\Sellary\sellary-backend\.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py -v`

Expected: pass.

### Task 3: Wire sales, returns, voids, and API

**Files:**
- Modify: `sellary-backend/services/sale_service.py`
- Modify: `sellary-backend/services/sale_return_service.py`
- Modify: `sellary-backend/services/transaction_reversal_service.py`
- Modify: `sellary-backend/api/customers.py`
- Modify: `sellary-backend/tests/integration/test_sales_endpoints.py`
- Modify: `sellary-backend/tests/integration/test_customers_endpoints.py`
- Modify: `sellary-backend/tests/integration/test_return_endpoints.py`
- Modify: `sellary-backend/tests/integration/test_transaction_reversal_endpoints.py`

- [ ] **Step 1: Write failing endpoint tests**

Cover:

```python
POST /api/sales payment_method=credit without customer_id -> 400
POST /api/sales payment_method=credit with customer_id -> response has payment_status=unpaid and remaining debt
GET /api/customers includes balance
GET /api/customers/{id}/ledger returns entries and balance
POST /api/customers/{id}/payments requires Idempotency-Key and reduces balance
POST /api/sales/{id}/return reduces credit debt
POST /api/sales/{id}/void reduces remaining credit debt
```

- [ ] **Step 2: Run failing endpoint tests**

Run targeted pytest files with `-v`.

- [ ] **Step 3: Implement endpoint wiring**

`SaleService.create()` validates customer for credit, stores `payment_method=credit`, sets `payment_status`, creates ledger entry, and returns credit summary fields.

`SaleReturnService` and `TransactionReversalService` call the ledger service after inventory mutations succeed.

`customers.py` returns balances and exposes ledger/payment endpoints with idempotency.

- [ ] **Step 4: Run backend targeted and compile checks**

Run:

```powershell
D:\Learning\Sellary\sellary-backend\.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py tests/integration/test_sales_endpoints.py tests/integration/test_customers_endpoints.py tests/integration/test_return_endpoints.py tests/integration/test_transaction_reversal_endpoints.py -v
D:\Learning\Sellary\sellary-backend\.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

### Task 4: Frontend API/types/hooks

**Files:**
- Modify: `sellary-frontend/src/lib/types.ts`
- Modify: `sellary-frontend/src/lib/api.ts`
- Modify: `sellary-frontend/src/hooks/useQueries.ts`

- [ ] **Step 1: Write failing frontend tests**

Add tests expecting credit types and customer payment API usage in POS/customers tests.

- [ ] **Step 2: Implement types/API/hooks**

Add `Customer.balance`, `Customer.description`, `CustomerLedgerEntry`, `CustomerLedgerResponse`, `CustomerPaymentPayload`, `CustomerPaymentResponse`, sale credit fields, and `payment_method: 'cash' | 'card' | 'mobile' | 'credit'`.

Add:

```ts
customersApi.getLedger(id)
customersApi.recordPayment(id, payload, idempotencyKey?)
useCustomers()
useCustomerLedger(customerId)
```

- [ ] **Step 3: Run frontend targeted tests**

Run: `npx vitest run src/app/(protected)/pos/__tests__/page.test.tsx src/app/(protected)/sales/__tests__/page.test.tsx`

### Task 5: POS credit customer flow

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/pos/page.tsx`
- Modify: `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing POS tests**

Tests:

```ts
it('requires a customer before completing a credit sale')
it('creates a quick customer and sends credit sale with customer_id')
```

- [ ] **Step 2: Implement POS UI**

When `paymentMethod === 'credit'`, show customer search/select and quick-create fields (`ФИО`, `Телефон`, `Описание`). Block sale completion until `selectedCustomer` exists. Submit `payment_method: 'credit'`, `customer_id`, no note.

- [ ] **Step 3: Run POS tests**

Run: `npx vitest run src/app/(protected)/pos/__tests__/page.test.tsx`

### Task 6: Clients page and sales debt status

**Files:**
- Create: `sellary-frontend/src/app/(protected)/customers/page.tsx`
- Create: `sellary-frontend/src/app/(protected)/customers/__tests__/page.test.tsx`
- Modify: `sellary-frontend/src/app/(protected)/sales/page.tsx`
- Modify: `sellary-frontend/src/app/(protected)/sales/__tests__/page.test.tsx`
- Modify: `sellary-frontend/src/components/Layout.tsx`
- Modify: `sellary-frontend/src/components/mobile/MoreSheet.tsx`

- [ ] **Step 1: Write failing UI tests**

Customers page test expects list, balance, ledger, and payment modal. Sales page test expects `В долг` chip and debt summary.

- [ ] **Step 2: Implement UI**

Add `Клиенты` navigation. Build a compact customers page with list/search, selected customer ledger panel, create form, and `Принять оплату долга` modal. Update sales payment chip and detail panel for credit debt.

- [ ] **Step 3: Run UI tests**

Run:

```powershell
npx vitest run src/app/(protected)/customers/__tests__/page.test.tsx src/app/(protected)/sales/__tests__/page.test.tsx
```

### Task 7: Full verification, merge, deploy

**Files:**
- All changed files.

- [ ] **Step 1: Run backend verification**

Run:

```powershell
D:\Learning\Sellary\sellary-backend\.venv\Scripts\pytest.exe tests/unit tests/integration
D:\Learning\Sellary\sellary-backend\.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
npx vitest run
npm run build
```

- [ ] **Step 3: Commit implementation and merge**

Commit from the worktree, merge into `main`, push `main`.

- [ ] **Step 4: Verify production**

Check Railway backend health and Netlify frontend. Confirm live frontend bundle contains `Клиенты`, `В долг`, and `Принять оплату долга`; confirm backend `/health` returns healthy.
