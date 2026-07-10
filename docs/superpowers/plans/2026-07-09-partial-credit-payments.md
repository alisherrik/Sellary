# Partial Credit Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let cashiers record an upfront partial payment during a credit sale, then continue accepting later partial debt payments through the existing customer ledger.

**Architecture:** Keep customer debt as the single source of truth in `customer_ledger_entries`. A credit sale records a positive `credit_sale` entry for the full sale amount and, when `paid_amount > 0`, immediately records a negative `payment` entry tied to the same sale. Later customer payments continue using the existing `/customers/{id}/payments` endpoint.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, PostgreSQL/SQLite tests, Next.js, React, TanStack Query, Vitest, Testing Library.

---

## File Structure

- Modify `sellary-backend/schemas/sale.py`: add optional `paid_amount` and `initial_payment_method` fields to `SaleCreate`, with validation that initial payment method cannot be `credit`.
- Modify `sellary-backend/services/sale_service.py`: validate the initial paid amount against the computed total and pass it to the ledger service.
- Modify `sellary-backend/services/customer_ledger_service.py`: let `record_credit_sale` write the initial sale-scoped payment entry and refresh sale status.
- Modify `sellary-backend/tests/unit/test_customer_ledger_service.py`: cover initial partial payment, full initial payment, overpayment, and missing real payment method.
- Modify `sellary-backend/tests/integration/test_customer_credit_endpoints.py`: cover API payload/response for initial partial credit payment.
- Modify `sellary-frontend/src/lib/posPricing.ts`: add a small helper for validating/formatting credit-sale upfront payment.
- Modify `sellary-frontend/src/lib/__tests__/posPricing.test.ts`: test the helper.
- Modify `sellary-frontend/src/app/(protected)/pos/page.tsx`: render upfront payment controls when `В долг` is selected and send `paid_amount` plus `initial_payment_method`.
- Modify `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`: test the POS payload and validation.

### Task 1: Backend Initial Payment Contract

**Files:**
- Modify: `sellary-backend/tests/unit/test_customer_ledger_service.py`
- Modify: `sellary-backend/tests/integration/test_customer_credit_endpoints.py`
- Modify: `sellary-backend/schemas/sale.py`
- Modify: `sellary-backend/services/sale_service.py`
- Modify: `sellary-backend/services/customer_ledger_service.py`

- [ ] **Step 1: Write failing service tests**

Add tests that create a `PaymentMethod.CREDIT` sale with `paid_amount=Decimal("10.00")` and `initial_payment_method=PaymentMethod.CASH`, then assert:

```python
assert sale.payment_status == "partial"
assert sale.credit_amount == Decimal("30.00")
assert sale.credit_paid_amount == Decimal("10.00")
assert sale.credit_remaining_amount == Decimal("20.00")
assert ledger.get_customer_balance(test_customer.id) == Decimal("20.00")
```

Also assert two ledger rows exist for that sale:

```python
assert entries[0].entry_type == CustomerLedgerEntryType.CREDIT_SALE
assert entries[0].amount == Decimal("30.00")
assert entries[1].entry_type == CustomerLedgerEntryType.PAYMENT
assert entries[1].amount == Decimal("-10.00")
assert entries[1].payment_method == "cash"
```

Add a second test with `paid_amount=Decimal("30.00")` and assert `payment_status == "settled"` and customer balance is `0.00`.

Add validation tests:

```python
with pytest.raises(ValueError, match="Initial payment exceeds sale total"):
    SaleService(...).create(payload_with_paid_amount_31, cashier_user.id)

with pytest.raises(ValueError, match="initial_payment_method is required"):
    SaleService(...).create(payload_with_paid_amount_but_no_method, cashier_user.id)
```

- [ ] **Step 2: Run service tests to verify RED**

Run from `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py -v
```

Expected: the new tests fail because `SaleCreate` does not accept or process `paid_amount` and `initial_payment_method`.

- [ ] **Step 3: Write failing endpoint test**

Add an integration test that posts:

```python
{
    **credit_sale_payload(test_customer.id, test_product.id),
    "paid_amount": "10.00",
    "initial_payment_method": "cash",
}
```

Assert the sale response:

```python
assert sale["payment_status"] == "partial"
assert sale["credit_amount"] == "30.00"
assert sale["credit_paid_amount"] == "10.00"
assert sale["credit_remaining_amount"] == "20.00"
```

Assert customer ledger balance is `"20.00"` and has both `credit_sale` and `payment` entries.

- [ ] **Step 4: Run endpoint test to verify RED**

Run from `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/integration/test_customer_credit_endpoints.py::test_credit_sale_accepts_initial_partial_payment -v
```

Expected: fail because the API contract does not yet support the fields.

- [ ] **Step 5: Implement minimal backend support**

In `schemas/sale.py`, add:

```python
paid_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
initial_payment_method: Optional[PaymentMethod] = None
```

Extend the existing validator:

```python
if self.paid_amount > 0 and self.payment_method != PaymentMethod.CREDIT:
    raise ValueError("paid_amount is only supported for credit sales")
if self.paid_amount > 0 and not self.initial_payment_method:
    raise ValueError("initial_payment_method is required when paid_amount is greater than zero")
if self.initial_payment_method == PaymentMethod.CREDIT:
    raise ValueError("initial_payment_method cannot be credit")
if self.paid_amount <= 0 and self.initial_payment_method:
    raise ValueError("initial_payment_method requires paid_amount")
```

In `SaleService.create`, after `total_amount` is computed, reject credit overpayment:

```python
if sale_create.paid_amount > total_amount:
    raise ValueError("Initial payment exceeds sale total")
```

Pass the initial payment to the ledger:

```python
self.customer_ledger.record_credit_sale(
    sale,
    cashier_id,
    initial_payment_amount=sale_create.paid_amount,
    initial_payment_method=sale_create.initial_payment_method,
)
```

In `CustomerLedgerService.record_credit_sale`, accept those optional parameters, write the `credit_sale` row first, then a `payment` row with negative amount tied to `sale.id` when amount is positive, and finally refresh `sale.payment_status`.

- [ ] **Step 6: Run backend focused tests to verify GREEN**

Run from `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py -v
.venv\Scripts\pytest.exe tests/integration/test_customer_credit_endpoints.py -v
```

Expected: all credit-ledger tests pass.

### Task 2: POS Upfront Payment UI

**Files:**
- Modify: `sellary-frontend/src/lib/__tests__/posPricing.test.ts`
- Modify: `sellary-frontend/src/lib/posPricing.ts`
- Modify: `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`
- Modify: `sellary-frontend/src/app/(protected)/pos/page.tsx`

- [ ] **Step 1: Write failing helper tests**

Add tests for:

```ts
expect(calculateCreditInitialPayment('40', 100)).toEqual({
  amount: 40,
  remaining: 60,
  exceedsTotal: false,
  isValid: true,
});
expect(calculateCreditInitialPayment('120', 100).exceedsTotal).toBe(true);
expect(calculateCreditInitialPayment('', 100).amount).toBe(0);
```

- [ ] **Step 2: Run helper test to verify RED**

Run from `sellary-frontend`:

```powershell
npx vitest run src/lib/__tests__/posPricing.test.ts
```

Expected: fail because the helper does not exist.

- [ ] **Step 3: Implement helper**

In `posPricing.ts`, export:

```ts
export function calculateCreditInitialPayment(value: string, total: number) {
  const parsed = parseEditableAmount(value);
  const roundedTotal = roundMoney(Math.max(0, total));
  const amount = parsed === null ? 0 : roundMoney(Math.max(0, parsed));
  const exceedsTotal = amount > roundedTotal;

  return {
    amount,
    remaining: roundMoney(Math.max(0, roundedTotal - amount)),
    exceedsTotal,
    isValid: !exceedsTotal,
  };
}
```

- [ ] **Step 4: Write failing POS component test**

Extend the credit checkout test so after selecting `В долг`, it enters `40` into `Оплачено сейчас`, selects `Мобильный` as the initial payment method, and expects:

```ts
expect(screen.getByText('Останется долг').parentElement).toHaveTextContent('60');
expect(salesApi.create).toHaveBeenCalledWith(
  expect.objectContaining({
    payment_method: 'credit',
    customer_id: 77,
    paid_amount: 40,
    initial_payment_method: 'mobile',
  }),
);
```

Add another POS test that enters an upfront amount above the total and asserts the complete-sale button is disabled.

- [ ] **Step 5: Run POS component test to verify RED**

Run from `sellary-frontend`:

```powershell
npx vitest run "src/app/(protected)/pos/__tests__/page.test.tsx"
```

Expected: fail because the controls and payload do not exist.

- [ ] **Step 6: Implement POS UI and payload**

In `page.tsx`, add state:

```ts
const [creditPaidAmount, setCreditPaidAmount] = useState('');
const [creditPaymentMethod, setCreditPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
```

Reset those values when checkout resets, active session changes, and when switching away from credit.

Compute:

```ts
const creditInitialPayment = useMemo(
  () => calculateCreditInitialPayment(creditPaidAmount, finalTotal),
  [creditPaidAmount, finalTotal],
);
```

When `paymentMethod === 'credit'`, render an input labelled `Оплачено сейчас`, a three-button method selector for `Наличные`, `Карта`, `Мобильный`, and a row labelled `Останется долг`.

Before submit, block overpayment:

```ts
if (paymentMethod === 'credit' && !creditInitialPayment.isValid) {
  toast.error('Первый платеж не может быть больше суммы продажи');
  return;
}
```

Add the API fields only when `creditInitialPayment.amount > 0`:

```ts
...(isCreditSale && creditInitialPayment.amount > 0
  ? {
      paid_amount: creditInitialPayment.amount,
      initial_payment_method: creditPaymentMethod,
    }
  : {}),
```

Disable the final button when the upfront amount exceeds the total.

- [ ] **Step 7: Run frontend focused tests to verify GREEN**

Run from `sellary-frontend`:

```powershell
npx vitest run src/lib/__tests__/posPricing.test.ts
npx vitest run "src/app/(protected)/pos/__tests__/page.test.tsx"
```

Expected: both focused suites pass.

### Task 3: Verification and Deploy

**Files:**
- No new code files unless deploy configuration reveals a required fix.

- [ ] **Step 1: Run backend verification**

Run from `sellary-backend`:

```powershell
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
.venv\Scripts\pytest.exe tests/unit/test_customer_ledger_service.py tests/integration/test_customer_credit_endpoints.py -v
```

Expected: exit code 0.

- [ ] **Step 2: Run frontend verification**

Run from `sellary-frontend`:

```powershell
npx vitest run src/lib/__tests__/posPricing.test.ts "src/app/(protected)/pos/__tests__/page.test.tsx"
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Deploy backend**

Check whether Railway CLI is authenticated:

```powershell
railway status
```

If authenticated and linked, deploy from repo root:

```powershell
railway up
```

If Railway CLI is unavailable or unauthenticated, report the exact blocker and leave the verified code ready for GitHub/Railway auto-deploy.

- [ ] **Step 4: Deploy frontend**

Check whether Netlify CLI is authenticated:

```powershell
netlify status
```

If authenticated and linked, deploy from repo root:

```powershell
netlify deploy --build --prod
```

If Netlify CLI is unavailable or unauthenticated, report the exact blocker and leave the verified code ready for GitHub/Netlify auto-deploy.

- [ ] **Step 5: Report**

Report implemented behavior, test commands with exit status, and deployed URLs or deployment blocker details.
