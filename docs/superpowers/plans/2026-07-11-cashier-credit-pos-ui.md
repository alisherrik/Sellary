# Cashier Credit POS UI (В долг) Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Enable the offline «В долг» (credit) checkout flow in the Tauri cashier: a customer picker + quick-create inside `PaymentModal`, an initial-payment ("Оплачено сейчас") input with a live "Останется долг" remaining, and a credit summary in Sales History — all local-first, no network required.

**Architecture:** Presentational, controlled components (mirroring the existing Phase-1 `PaymentModal`). `POSPage` owns all credit state + data access (`getCustomersWithLocalBalance`, `insertCustomer`); a new presentational `CreditPanel` renders the picker/quick-create/initial-payment UI from props; `pos-payload.buildNewSaleInput` folds the credit fields into the existing `NewSaleInput`; the credit sale enters the Phase-1 outbox like any other sale. History gets a «В долг» `PaymentChip` variant and a locally-derived debt summary in `SaleDetailPanel`.

**Tech Stack:** Tauri 2 / React 18 / TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`) / Vite / Vitest + Testing Library (jsdom) on Node 24.

**Depends on:** `2026-07-11-cashier-local-data-model.md` (data-model) — supplies the customer DAOs (`insertCustomer`, `getCustomersWithLocalBalance`, `getCustomerByClientId`), the `CustomerWithBalance` type, local migration `003` (adds `sales.customer_client_id` + `sales.initial_payment_method`, the `customers` table), and the `NewSaleInput` / `LocalSale` credit-field extensions. This plan consumes those by their exact names and does NOT create migration `003` or any DAO itself.

---

## Interface contract consumed from data-model

This plan is written against these exact data-model exports (all from `src/lib/db.ts`). If any differ at execution time, adjust the call sites — the shapes below are the assumption:

```ts
// db.ts (added by data-model)
export interface CustomerWithBalance {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  local_balance: number;      // balance + Σ unsynced credit remaining − Σ unsynced payments
  is_active: number;
  sync_status: string;
  error_kind: string | null;
}

export interface NewCustomerInput {
  name: string;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
}

export function insertCustomer(input: NewCustomerInput): Promise<{ clientCustomerId: string }>;
export function getCustomersWithLocalBalance(): Promise<CustomerWithBalance[]>;
export function getCustomerByClientId(clientCustomerId: string): Promise<CustomerWithBalance | null>;

// NewSaleInput gains (data-model):
//   customer_client_id: string | null;
//   initial_payment_method: string | null;   // 'cash'|'card'|'mobile' when initial payment > 0, else null
// LocalSale gains (data-model):
//   customer_client_id: string | null;
//   initial_payment_method: string | null;
```

`payment_method` already accepts an arbitrary lowercase string (`'credit'` needs no schema change beyond the data-model columns). `paid_amount` already exists and holds the initial payment.

---

## File Structure

- **Modify** `src/lib/__tests__/posPricing.test.ts` — add golden cases for `calculateCreditInitialPayment`.
- **Modify** `src/lib/posPricing.ts` — ensure `calculateCreditInitialPayment` is present (already copied from web; add only if missing).
- **Modify** `src/lib/pos-payload.ts` — add `'credit'` to `CashierPaymentMethod`, add `CashierCreditPaymentMethod`, fold credit fields into `buildNewSaleInput`.
- **Modify** `src/lib/__tests__/pos-payload.test.ts` — credit-path assertions.
- **Create** `src/pages/pos/CreditPanel.tsx` — presentational customer picker + quick-create + initial-payment UI.
- **Create** `src/pages/pos/__tests__/CreditPanel.test.tsx` — RTL for the panel.
- **Modify** `src/pages/pos/PaymentModal.tsx` — enable the «В долг» tab; render `CreditPanel`; gate confirm on customer + valid initial payment.
- **Modify** `src/pages/pos/__tests__/PaymentModal.test.tsx` — credit tab + gating.
- **Modify** `src/pages/POSPage.tsx` — own credit state, load customers, quick-create, pass the bundle through and into `buildNewSaleInput`.
- **Modify** `src/components/history/PaymentChip.tsx` — «В долг» variant.
- **Modify** `src/components/history/__tests__/PaymentChip.test.tsx` — credit chip case.
- **Modify** `src/components/history/SaleDetailPanel.tsx` — locally-derived credit/debt summary.
- **Modify** `src/components/history/__tests__/SaleDetailPanel.test.tsx` — credit summary case.

All test commands run from `sellary-cashier/`. Typecheck gate: `npx tsc --noEmit` (exit 0).

---

### Task 1: Golden test for `calculateCreditInitialPayment`

**Files:**
- `src/lib/__tests__/posPricing.test.ts` (modify)
- `src/lib/posPricing.ts` (verify; modify only if missing)

The cashier `posPricing.ts` already contains `calculateCreditInitialPayment` (copied verbatim from `sellary-frontend/src/lib/posPricing.ts`). This task pins its behavior with golden cases.

1. Add golden cases. Append this `describe` block to `src/lib/__tests__/posPricing.test.ts` and add `calculateCreditInitialPayment` to the import list at the top:

Change the import block from:
```ts
import {
  calculateCashPayment,
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
  parseEditableAmount,
} from '../posPricing';
```
to:
```ts
import {
  calculateCashPayment,
  calculateCreditInitialPayment,
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
  parseEditableAmount,
} from '../posPricing';
```

Then append this block after the existing `describe('posPricing golden cases', …)`:
```ts
describe('calculateCreditInitialPayment', () => {
  it('treats an empty initial payment as full remaining debt', () => {
    const r = calculateCreditInitialPayment('', 10000);
    expect(r.amount).toBe(0);
    expect(r.remaining).toBe(10000);
    expect(r.exceedsTotal).toBe(false);
    expect(r.isValid).toBe(true);
  });

  it('splits a partial initial payment into paid + remaining', () => {
    const r = calculateCreditInitialPayment('4000', 10000);
    expect(r.amount).toBe(4000);
    expect(r.remaining).toBe(6000);
    expect(r.isValid).toBe(true);
  });

  it('a full initial payment leaves zero remaining and is valid', () => {
    const r = calculateCreditInitialPayment('10000', 10000);
    expect(r.amount).toBe(10000);
    expect(r.remaining).toBe(0);
    expect(r.isValid).toBe(true);
  });

  it('flags an initial payment greater than the total as invalid', () => {
    const r = calculateCreditInitialPayment('12000', 10000);
    expect(r.amount).toBe(12000);
    expect(r.remaining).toBe(0);
    expect(r.exceedsTotal).toBe(true);
    expect(r.isValid).toBe(false);
  });

  it('clamps negative input to zero', () => {
    const r = calculateCreditInitialPayment('-500', 10000);
    expect(r.amount).toBe(0);
    expect(r.remaining).toBe(10000);
    expect(r.isValid).toBe(true);
  });
});
```

2. Run and see the result:
```
npx vitest run src/lib/__tests__/posPricing.test.ts
```
Expected: PASS (10 tests) — `calculateCreditInitialPayment` is already exported.

3. If instead it FAILS with `calculateCreditInitialPayment is not a function` / `not exported`, add the helper to `src/lib/posPricing.ts` (insert directly after `calculateCashPayment`), then re-run:
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
Re-run step 2 → PASS.

4. Commit:
```
git add src/lib/posPricing.ts src/lib/__tests__/posPricing.test.ts
git commit -m "test(cashier): pin calculateCreditInitialPayment golden cases"
```

---

### Task 2: Credit fields in `buildNewSaleInput`

**Files:**
- `src/lib/__tests__/pos-payload.test.ts` (modify)
- `src/lib/pos-payload.ts` (modify)

1. Write the failing test. Append this `describe` block to `src/lib/__tests__/pos-payload.test.ts` (the existing `product`/`line` helpers are reused):
```ts
describe('buildNewSaleInput — credit (В долг)', () => {
  it('emits a credit sale with customer, partial paid amount and initial method', () => {
    const input = buildNewSaleInput({
      items: [line()], // 2 × 5000 + 12% tax → total 11200
      paymentMethod: 'credit',
      cardType: null,
      cashReceived: '',
      cashier: { userId: 3, username: 'kassir' },
      nowIso: '2026-07-11T10:00:00.000Z',
      clientSaleId: 'cs-credit-1',
      idempotencyKey: 'ik-credit-1',
      customerClientId: 'cust-abc',
      creditPaidAmount: '4000',
      creditPaymentMethod: 'card',
    });
    expect(input.payment_method).toBe('credit');
    expect(input.customer_client_id).toBe('cust-abc');
    expect(input.paid_amount).toBe(4000);
    expect(input.initial_payment_method).toBe('card');
    expect(input.change_amount).toBe(0);
    expect(input.card_type).toBeNull();
    expect(input.total_amount).toBe(11200);
  });

  it('omits initial_payment_method when the initial payment is zero', () => {
    const input = buildNewSaleInput({
      items: [line()],
      paymentMethod: 'credit',
      cardType: null,
      cashReceived: '',
      cashier: { userId: 3, username: 'kassir' },
      nowIso: '2026-07-11T10:00:00.000Z',
      clientSaleId: 'cs-credit-2',
      idempotencyKey: 'ik-credit-2',
      customerClientId: 'cust-abc',
      creditPaidAmount: '',
      creditPaymentMethod: 'cash',
    });
    expect(input.payment_method).toBe('credit');
    expect(input.customer_client_id).toBe('cust-abc');
    expect(input.paid_amount).toBe(0);
    expect(input.initial_payment_method).toBeNull();
  });

  it('leaves customer_client_id null and no initial method for non-credit sales', () => {
    const input = buildNewSaleInput({
      items: [line()],
      paymentMethod: 'cash',
      cardType: null,
      cashReceived: '12000',
      cashier: { userId: 1, username: 'k' },
      nowIso: '2026-07-11T10:00:00.000Z',
      clientSaleId: 'cs-cash-1',
      idempotencyKey: 'ik-cash-1',
    });
    expect(input.customer_client_id).toBeNull();
    expect(input.initial_payment_method).toBeNull();
    expect(input.paid_amount).toBe(12000);
    expect(input.change_amount).toBe(800);
  });
});
```

2. Run and see it FAIL:
```
npx vitest run src/lib/__tests__/pos-payload.test.ts
```
Expected: FAIL — TypeScript/runtime error that `paymentMethod: 'credit'` is not assignable to `CashierPaymentMethod`, and `customer_client_id` / `initial_payment_method` do not exist on the result.

3. Implement. Replace the entire contents of `src/lib/pos-payload.ts` with:
```ts
import type { NewSaleInput } from './db';
import { calculateCashPayment, calculateCreditInitialPayment, calculatePosPricing } from './posPricing';
import type { CartLine } from './cart-store';

export interface SaleIdentity {
  userId: number | null;
  username: string | null;
}

export type CashierPaymentMethod = 'cash' | 'card' | 'mobile' | 'credit';
export type CashierCardType = 'alif' | 'eskhata' | 'dc';
export type CashierCreditPaymentMethod = 'cash' | 'card' | 'mobile';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Fresh unique ids for a new sale (client_sale_id + idempotency_key). */
export function newSaleIds(): { clientSaleId: string; idempotencyKey: string } {
  return {
    clientSaleId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  };
}

/**
 * Build the local NewSaleInput from the cart. Money mirrors the cart totals
 * (calculatePosPricing); sale_items carry base-unit snapshots so the receipt is
 * drift-proof and the sync payload stays base-unit (§7.5). payment_method /
 * card_type are canonical lowercase (§7.4). For a credit ('В долг') sale the
 * customer + initial payment ride along; the server recomputes the remaining
 * debt authoritatively (spec §5.1).
 */
export function buildNewSaleInput(params: {
  items: CartLine[];
  paymentMethod: CashierPaymentMethod;
  cardType: CashierCardType | null;
  cashReceived: string;
  cashier: SaleIdentity;
  nowIso: string;
  clientSaleId: string;
  idempotencyKey: string;
  customerClientId?: string | null;
  creditPaidAmount?: string;
  creditPaymentMethod?: CashierCreditPaymentMethod;
}): NewSaleInput {
  const {
    items, paymentMethod, cardType, cashReceived, cashier, nowIso, clientSaleId, idempotencyKey,
    customerClientId = null, creditPaidAmount = '', creditPaymentMethod = 'cash',
  } = params;

  const saleItems = items.map((line, index) => {
    const factor = line.unit.factor || 1;
    const baseQty = round2(line.quantity * factor);
    const baseUnitPrice = round2(line.unit.price / factor);
    const taxPercent = Number(line.product.tax_percent);
    const lineSubtotal = round2(baseUnitPrice * baseQty);
    const lineTotal = round2(lineSubtotal * (1 + taxPercent / 100));
    return {
      product_id: line.product.id,
      product_name: line.product.name,
      barcode: line.product.barcode,
      uom: line.product.uom,
      quantity: baseQty,
      unit_price: baseUnitPrice,
      tax_percent: taxPercent,
      line_subtotal: lineSubtotal,
      line_total: lineTotal,
      sort_order: index,
    };
  });

  const subtotal = round2(
    items.reduce((sum, line) => sum + line.unit.price * line.quantity, 0),
  );
  const taxAmount = round2(
    items.reduce(
      (sum, line) =>
        sum + line.unit.price * line.quantity * (Number(line.product.tax_percent) / 100),
      0,
    ),
  );
  const discountAmount = round2(
    items.reduce((sum, line) => sum + Math.max(0, line.discount || 0), 0),
  );
  const { finalTotal } = calculatePosPricing({
    subtotal,
    tax: taxAmount,
    itemDiscounts: discountAmount,
    overallDiscount: 0,
  });

  const isCredit = paymentMethod === 'credit';
  const credit = isCredit ? calculateCreditInitialPayment(creditPaidAmount, finalTotal) : null;
  const cash = calculateCashPayment(cashReceived, finalTotal);

  let paidAmount: number;
  let changeAmount: number;
  if (isCredit) {
    paidAmount = credit!.amount;
    changeAmount = 0;
  } else if (paymentMethod === 'cash') {
    paidAmount = cash.received ?? finalTotal;
    changeAmount = cash.change;
  } else {
    paidAmount = finalTotal;
    changeAmount = 0;
  }

  // Initial-payment method is only stored when money actually changed hands (spec §1).
  const initialPaymentMethod = isCredit && credit!.amount > 0 ? creditPaymentMethod : null;

  return {
    client_sale_id: clientSaleId,
    idempotency_key: idempotencyKey,
    created_at_client: nowIso,
    payment_method: paymentMethod,
    card_type: paymentMethod === 'card' ? cardType : null,
    customer_client_id: isCredit ? customerClientId : null,
    initial_payment_method: initialPaymentMethod,
    subtotal,
    discount_amount: discountAmount,
    tax_amount: taxAmount,
    total_amount: finalTotal,
    paid_amount: paidAmount,
    change_amount: changeAmount,
    notes: null,
    cashier_user_id: cashier.userId,
    cashier_username: cashier.username,
    items: saleItems,
  };
}
```

4. Run the whole affected surface and see it PASS:
```
npx vitest run src/lib/__tests__/pos-payload.test.ts
npx tsc --noEmit
```
Expected: all `pos-payload` tests PASS (existing 4 + new 3); `tsc` exits 0.

5. Commit:
```
git add src/lib/pos-payload.ts src/lib/__tests__/pos-payload.test.ts
git commit -m "feat(cashier): carry credit customer + initial payment in buildNewSaleInput"
```

---

### Task 3: `CreditPanel` presentational component

**Files:**
- `src/pages/pos/__tests__/CreditPanel.test.tsx` (create)
- `src/pages/pos/CreditPanel.tsx` (create)

1. Write the failing test. Create `src/pages/pos/__tests__/CreditPanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreditPanel, type CreditPanelProps } from '../CreditPanel';
import type { CustomerWithBalance } from '../../../lib/db';

const customer = (over: Partial<CustomerWithBalance> = {}): CustomerWithBalance => ({
  client_customer_id: 'c1',
  server_id: 1,
  name: 'Иван',
  phone: '+998901112233',
  email: null,
  address: null,
  description: null,
  is_active: 1,
  sync_status: 'synced',
  error_kind: null,
  local_balance: 0,
  ...over,
});

function setup(over: Partial<CreditPanelProps> = {}) {
  const props: CreditPanelProps = {
    total: 10000,
    customers: [customer()],
    search: '',
    onSearch: vi.fn(),
    selectedCustomerId: null,
    onSelect: vi.fn(),
    qcName: '',
    onQcName: vi.fn(),
    qcPhone: '',
    onQcPhone: vi.fn(),
    qcDescription: '',
    onQcDescription: vi.fn(),
    creatingCustomer: false,
    onCreateCustomer: vi.fn(),
    paidAmount: '',
    onPaidAmount: vi.fn(),
    paymentMethod: 'cash',
    onPaymentMethod: vi.fn(),
    ...over,
  };
  const utils = render(<CreditPanel {...props} />);
  return { props, ...utils };
}

describe('CreditPanel', () => {
  it('renders a customer debt in red when local_balance > 0', () => {
    const { container } = setup({ customers: [customer({ name: 'Должник', local_balance: 5000 })] });
    expect(screen.getByText('Должник')).toBeInTheDocument();
    expect(container.querySelector('.text-red-600')).not.toBeNull();
  });

  it('calls onSelect with the client_customer_id when a customer row is clicked', () => {
    const { props } = setup({ customers: [customer({ client_customer_id: 'c9', name: 'Пётр' })] });
    fireEvent.click(screen.getByText('Пётр'));
    expect(props.onSelect).toHaveBeenCalledWith('c9');
  });

  it('disables «Создать клиента» until both name and phone are present', () => {
    const { rerender, props } = setup({ qcName: '', qcPhone: '' });
    expect(screen.getByRole('button', { name: /Создать клиента/ })).toBeDisabled();
    rerender(<CreditPanel {...props} qcName="Анна" qcPhone="+998900000000" />);
    const btn = screen.getByRole('button', { name: /Создать клиента/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(props.onCreateCustomer).toHaveBeenCalled();
  });

  it('flags an initial payment greater than the total', () => {
    setup({ paidAmount: '15000', total: 10000 });
    expect(screen.getByText(/Первый платёж больше суммы продажи/)).toBeInTheDocument();
  });

  it('shows the «Останется долг» label and forwards the paid-amount input', () => {
    const { props } = setup({ paidAmount: '4000', total: 10000 });
    expect(screen.getByText('Останется долг')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Оплачено сейчас'), { target: { value: '6000' } });
    expect(props.onPaidAmount).toHaveBeenCalledWith('6000');
  });
});
```

2. Run and see it FAIL:
```
npx vitest run src/pages/pos/__tests__/CreditPanel.test.tsx
```
Expected: FAIL — cannot resolve `../CreditPanel` (module does not exist yet).

3. Implement. Create `src/pages/pos/CreditPanel.tsx`:
```tsx
import {
  BanknotesIcon, CreditCardIcon, DevicePhoneMobileIcon, MagnifyingGlassIcon, UserPlusIcon,
} from '@heroicons/react/24/outline';
import { formatCurrency } from '../../lib/format';
import { calculateCreditInitialPayment } from '../../lib/posPricing';
import type { CashierCreditPaymentMethod } from '../../lib/pos-payload';
import type { CustomerWithBalance } from '../../lib/db';

const CREDIT_METHODS: { id: CashierCreditPaymentMethod; label: string; Icon: typeof BanknotesIcon }[] = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
];

export interface CreditPanelProps {
  total: number;
  customers: CustomerWithBalance[];
  search: string;
  onSearch: (v: string) => void;
  selectedCustomerId: string | null;
  onSelect: (clientCustomerId: string) => void;
  qcName: string;
  onQcName: (v: string) => void;
  qcPhone: string;
  onQcPhone: (v: string) => void;
  qcDescription: string;
  onQcDescription: (v: string) => void;
  creatingCustomer: boolean;
  onCreateCustomer: () => void;
  paidAmount: string;
  onPaidAmount: (v: string) => void;
  paymentMethod: CashierCreditPaymentMethod;
  onPaymentMethod: (m: CashierCreditPaymentMethod) => void;
}

export function CreditPanel(props: CreditPanelProps) {
  const {
    total, customers, search, onSearch, selectedCustomerId, onSelect,
    qcName, onQcName, qcPhone, onQcPhone, qcDescription, onQcDescription,
    creatingCustomer, onCreateCustomer, paidAmount, onPaidAmount, paymentMethod, onPaymentMethod,
  } = props;

  const q = search.trim().toLowerCase();
  const visible = q
    ? customers.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
      )
    : customers;

  const credit = calculateCreditInitialPayment(paidAmount, total);
  const canCreate = qcName.trim().length > 0 && qcPhone.trim().length > 0 && !creatingCustomer;

  return (
    <div className="mb-3 space-y-3">
      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Поиск клиента…"
          aria-label="Поиск клиента"
          className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>

      {/* Customer list */}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-1 py-2 text-center text-[12px] text-gray-400">Клиенты не найдены</p>
        ) : (
          visible.map((c) => {
            const selected = c.client_customer_id === selectedCustomerId;
            const debt = c.local_balance;
            return (
              <button
                key={c.client_customer_id}
                type="button"
                onClick={() => onSelect(c.client_customer_id)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                  selected
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold text-gray-900 dark:text-white">{c.name}</span>
                  {c.phone && <span className="block truncate text-[11px] text-gray-400">{c.phone}</span>}
                </span>
                {debt > 0 && (
                  <span className="shrink-0 text-[12px] font-bold tabular-nums text-red-600">
                    {formatCurrency(debt)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Quick-create */}
      <div className="rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-600">
        <p className="mb-2 text-[12px] font-semibold text-gray-500">Новый клиент</p>
        <div className="space-y-2">
          <input
            type="text"
            value={qcName}
            onChange={(e) => onQcName(e.target.value)}
            placeholder="ФИО"
            aria-label="ФИО клиента"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="tel"
            value={qcPhone}
            onChange={(e) => onQcPhone(e.target.value)}
            placeholder="Телефон"
            aria-label="Телефон клиента"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="text"
            value={qcDescription}
            onChange={(e) => onQcDescription(e.target.value)}
            placeholder="Примечание (необязательно)"
            aria-label="Примечание"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            type="button"
            onClick={onCreateCustomer}
            disabled={!canCreate}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gray-900 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-600"
          >
            <UserPlusIcon className="h-4 w-4" /> Создать клиента
          </button>
        </div>
      </div>

      {/* Initial payment */}
      <div>
        <label className="mb-1 block text-[12px] font-semibold text-gray-500">Оплачено сейчас</label>
        <input
          type="number"
          value={paidAmount}
          onChange={(e) => onPaidAmount(e.target.value)}
          placeholder="0"
          aria-label="Оплачено сейчас"
          className="mb-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <div className="mb-2 grid grid-cols-3 gap-2">
          {CREDIT_METHODS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPaymentMethod(id)}
              className={`flex items-center justify-center gap-1 rounded-xl border py-2 text-[12px] font-bold ${
                paymentMethod === id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Останется долг</span>
          <span className={`font-bold tabular-nums ${credit.isValid ? 'text-amber-600' : 'text-red-600'}`}>
            {formatCurrency(credit.remaining)}
          </span>
        </div>
        {!credit.isValid && (
          <p className="mt-1 text-[11px] font-medium text-red-600">Первый платёж больше суммы продажи</p>
        )}
      </div>
    </div>
  );
}
```

4. Run and see it PASS:
```
npx vitest run src/pages/pos/__tests__/CreditPanel.test.tsx
npx tsc --noEmit
```
Expected: 5 tests PASS; `tsc` exits 0.

5. Commit:
```
git add src/pages/pos/CreditPanel.tsx src/pages/pos/__tests__/CreditPanel.test.tsx
git commit -m "feat(cashier): add CreditPanel customer picker + initial-payment UI"
```

---

### Task 4: Enable the «В долг» tab in `PaymentModal`

**Files:**
- `src/pages/pos/__tests__/PaymentModal.test.tsx` (modify)
- `src/pages/pos/PaymentModal.tsx` (modify)

1. Update the test. Replace the entire contents of `src/pages/pos/__tests__/PaymentModal.test.tsx` with:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentModal } from '../PaymentModal';
import type { CustomerWithBalance } from '../../../lib/db';

const customer = (over: Partial<CustomerWithBalance> = {}): CustomerWithBalance => ({
  client_customer_id: 'c1',
  server_id: 1,
  name: 'Иван',
  phone: '+998901112233',
  email: null,
  address: null,
  description: null,
  is_active: 1,
  sync_status: 'synced',
  error_kind: null,
  local_balance: 0,
  ...over,
});

const creditBundle = (over = {}) => ({
  customers: [customer()],
  search: '',
  onSearch: () => {},
  selectedCustomerId: null as string | null,
  onSelect: () => {},
  qcName: '',
  onQcName: () => {},
  qcPhone: '',
  onQcPhone: () => {},
  qcDescription: '',
  onQcDescription: () => {},
  creatingCustomer: false,
  onCreateCustomer: () => {},
  paidAmount: '',
  onPaidAmount: () => {},
  paymentMethod: 'cash' as const,
  onPaymentMethod: () => {},
  ...over,
});

const base = {
  open: true,
  total: 10000,
  method: 'cash' as const,
  onMethod: () => {},
  cardType: null,
  onCardType: () => {},
  cashReceived: '',
  onCashReceived: () => {},
  loading: false,
  onConfirm: vi.fn(),
  onClose: () => {},
  credit: creditBundle(),
};

describe('PaymentModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PaymentModal {...base} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers an enabled «В долг» tab and shows the picker when credit is active', () => {
    const onMethod = vi.fn();
    const { rerender } = render(<PaymentModal {...base} onMethod={onMethod} />);
    const creditTab = screen.getByText(/В долг/).closest('button')!;
    expect(creditTab).not.toBeDisabled();
    fireEvent.click(creditTab);
    expect(onMethod).toHaveBeenCalledWith('credit');
    rerender(<PaymentModal {...base} method="credit" />);
    expect(screen.getByLabelText('Поиск клиента')).toBeInTheDocument();
    expect(screen.getByText('Иван')).toBeInTheDocument();
  });

  it('gates the credit confirm on a selected customer and a valid initial payment', () => {
    const { rerender } = render(
      <PaymentModal {...base} method="credit" credit={creditBundle({ selectedCustomerId: null })} />,
    );
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();

    rerender(
      <PaymentModal {...base} method="credit" credit={creditBundle({ selectedCustomerId: 'c1', paidAmount: '4000' })} />,
    );
    expect(screen.getByText('Завершить продажу').closest('button')!).not.toBeDisabled();

    rerender(
      <PaymentModal {...base} method="credit" credit={creditBundle({ selectedCustomerId: 'c1', paidAmount: '15000' })} />,
    );
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
  });

  it('gates confirm until cash is sufficient', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="5000" />);
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
    rerender(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="12000" />);
    fireEvent.click(screen.getByText('Завершить продажу'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('gates confirm on card until a card type is chosen', () => {
    const { rerender } = render(<PaymentModal {...base} method="card" cardType={null} />);
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
    rerender(<PaymentModal {...base} method="card" cardType="alif" />);
    expect(screen.getByText('Завершить продажу').closest('button')!).not.toBeDisabled();
  });
});
```

2. Run and see it FAIL:
```
npx vitest run src/pages/pos/__tests__/PaymentModal.test.tsx
```
Expected: FAIL — the credit tab is still `disabled`; `credit` prop is unknown; `Поиск клиента` is not rendered.

3. Implement. Replace the entire contents of `src/pages/pos/PaymentModal.tsx` with:
```tsx
import {
  BanknotesIcon, CreditCardIcon, DevicePhoneMobileIcon, DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { formatCurrency } from '../../lib/format';
import { calculateCashPayment, calculateCreditInitialPayment } from '../../lib/posPricing';
import type { CashierCardType, CashierPaymentMethod } from '../../lib/pos-payload';
import { CreditPanel, type CreditPanelProps } from './CreditPanel';

const CARD_TYPES: { id: CashierCardType; label: string }[] = [
  { id: 'alif', label: 'Alif' },
  { id: 'eskhata', label: 'Eskhata' },
  { id: 'dc', label: 'DC' },
];

const METHODS: { id: CashierPaymentMethod; label: string; Icon: typeof BanknotesIcon }[] = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
];

// The credit bundle is CreditPanelProps minus `total` (PaymentModal owns the total).
export type CreditModalState = Omit<CreditPanelProps, 'total'>;

interface PaymentModalProps {
  open: boolean;
  total: number;
  method: CashierPaymentMethod;
  onMethod: (m: CashierPaymentMethod) => void;
  cardType: CashierCardType | null;
  onCardType: (c: CashierCardType) => void;
  cashReceived: string;
  onCashReceived: (v: string) => void;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
  credit: CreditModalState;
}

export function PaymentModal(props: PaymentModalProps) {
  const {
    open, total, method, onMethod, cardType, onCardType,
    cashReceived, onCashReceived, loading, onConfirm, onClose, credit,
  } = props;
  if (!open) return null;

  const cash = calculateCashPayment(cashReceived, total);
  const creditCalc = calculateCreditInitialPayment(credit.paidAmount, total);
  const canConfirm =
    !loading &&
    (method !== 'cash' || cash.isSufficient) &&
    (method !== 'card' || cardType !== null) &&
    (method !== 'credit' || (credit.selectedCustomerId !== null && creditCalc.isValid));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-end justify-between">
          <span className="font-bold text-gray-900 dark:text-white">К оплате</span>
          <span className="text-[28px] font-extrabold tabular-nums text-gray-900 dark:text-white">
            {formatCurrency(total)}
          </span>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {METHODS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onMethod(id)}
              className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold ${
                method === id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <Icon className="h-5 w-5" /> {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onMethod('credit')}
            className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold ${
              method === 'credit'
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
            }`}
          >
            <DocumentTextIcon className="h-5 w-5" /> В долг
          </button>
        </div>

        {method === 'card' && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {CARD_TYPES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onCardType(c.id)}
                className={`rounded-xl border py-2 text-sm font-semibold ${
                  cardType === c.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {method === 'cash' && (
          <div className="mb-3">
            <input
              type="number"
              value={cashReceived}
              onChange={(e) => onCashReceived(e.target.value)}
              placeholder="Получено"
              className="mb-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            {cash.received !== null && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Сдача</span>
                <span className="font-bold text-green-600 tabular-nums">{formatCurrency(cash.change)}</span>
              </div>
            )}
          </div>
        )}

        {method === 'credit' && <CreditPanel total={total} {...credit} />}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-2xl border border-gray-200 font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="h-12 flex-[2] rounded-2xl text-[16px] font-extrabold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
          >
            {loading ? 'Сохранение…' : 'Завершить продажу'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

4. Run and see it PASS:
```
npx vitest run src/pages/pos/__tests__/PaymentModal.test.tsx
npx tsc --noEmit
```
Expected: 5 tests PASS. `tsc` will still FAIL at `POSPage.tsx` because it does not yet pass the `credit` prop — that is fixed in Task 5. Confirm the failure is ONLY the missing `credit` prop in `POSPage.tsx` (`Property 'credit' is missing`), then proceed.

5. Commit:
```
git add src/pages/pos/PaymentModal.tsx src/pages/pos/__tests__/PaymentModal.test.tsx
git commit -m "feat(cashier): enable В долг tab and render CreditPanel in PaymentModal"
```

---

### Task 5: Wire credit state + customer data through `POSPage`

**Files:**
- `src/pages/POSPage.tsx` (modify)

`POSPage` has no test file; the gate for this task is `npx tsc --noEmit` exiting 0 and the full suite staying green. Make these edits.

1. Extend the `db` import (line ~4-6) to pull the customer DAOs. Change:
```ts
import {
  getProducts, getCategories, getProductByBarcode, insertSale,
} from '../lib/db';
import type { LocalProduct, LocalCategory } from '../lib/db';
```
to:
```ts
import {
  getProducts, getCategories, getProductByBarcode, insertSale,
  getCustomersWithLocalBalance, insertCustomer,
} from '../lib/db';
import type { LocalProduct, LocalCategory, CustomerWithBalance } from '../lib/db';
```

2. Extend the `pos-payload` import. Change:
```ts
import {
  buildNewSaleInput, newSaleIds, type CashierCardType, type CashierPaymentMethod,
} from '../lib/pos-payload';
```
to:
```ts
import {
  buildNewSaleInput, newSaleIds,
  type CashierCardType, type CashierPaymentMethod, type CashierCreditPaymentMethod,
} from '../lib/pos-payload';
```

3. Add credit state next to the existing payment state (after the `cashReceived` state near line 47):
```ts
  const [creditCustomers, setCreditCustomers] = useState<CustomerWithBalance[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [qcName, setQcName] = useState('');
  const [qcPhone, setQcPhone] = useState('');
  const [qcDescription, setQcDescription] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [creditPaidAmount, setCreditPaidAmount] = useState('');
  const [creditPaymentMethod, setCreditPaymentMethod] = useState<CashierCreditPaymentMethod>('cash');
```

4. Add a customer loader + lazy load when the credit tab is active. Place after `reloadProducts` (near line 56):
```ts
  const reloadCustomers = useCallback(async () => {
    const list = await getCustomersWithLocalBalance();
    setCreditCustomers(list);
  }, []);

  useEffect(() => {
    if (showPayment && method === 'credit') void reloadCustomers();
  }, [showPayment, method, reloadCustomers]);
```

5. Add the quick-create handler. Place after `reloadCustomers`:
```ts
  const handleCreateCustomer = useCallback(async () => {
    const name = qcName.trim();
    const phone = qcPhone.trim();
    if (!name || !phone) {
      toast.error('Укажите ФИО и телефон клиента');
      return;
    }
    setCreatingCustomer(true);
    try {
      const { clientCustomerId } = await insertCustomer({
        name,
        phone,
        description: qcDescription.trim() || null,
      });
      setQcName('');
      setQcPhone('');
      setQcDescription('');
      await reloadCustomers();
      setSelectedCustomerId(clientCustomerId);
      toast.success('Клиент создан');
    } catch (err) {
      toast.error('Не удалось создать клиента');
      console.error('insertCustomer failed', err);
    } finally {
      setCreatingCustomer(false);
    }
  }, [qcName, qcPhone, qcDescription, reloadCustomers]);
```

6. Reset credit state when opening the payment modal. In `openPayment` (near line 145) change:
```ts
  const openPayment = useCallback(() => {
    if (items.length === 0) return;
    setCashReceived(String(Math.ceil(finalTotal)));
    setMethod('cash');
    setCardType(null);
    setShowPayment(true);
  }, [items.length, finalTotal]);
```
to:
```ts
  const openPayment = useCallback(() => {
    if (items.length === 0) return;
    setCashReceived(String(Math.ceil(finalTotal)));
    setMethod('cash');
    setCardType(null);
    setSelectedCustomerId(null);
    setCustomerSearch('');
    setCreditPaidAmount('');
    setCreditPaymentMethod('cash');
    setQcName('');
    setQcPhone('');
    setQcDescription('');
    setShowPayment(true);
  }, [items.length, finalTotal]);
```

7. Pass the credit fields into `buildNewSaleInput` and refresh balances after a credit sale. In `handleComplete` (near line 154) change the `buildNewSaleInput` call:
```ts
    const input = buildNewSaleInput({
      items,
      paymentMethod: method,
      cardType,
      cashReceived,
      cashier: { userId, username },
      nowIso: new Date().toISOString(),
      clientSaleId,
      idempotencyKey,
    });
```
to:
```ts
    if (method === 'credit' && !selectedCustomerId) {
      setLoading(false);
      toast.error('Выберите клиента для продажи в долг');
      return;
    }
    const input = buildNewSaleInput({
      items,
      paymentMethod: method,
      cardType,
      cashReceived,
      cashier: { userId, username },
      nowIso: new Date().toISOString(),
      clientSaleId,
      idempotencyKey,
      customerClientId: selectedCustomerId,
      creditPaidAmount,
      creditPaymentMethod,
    });
```
Then, inside the same `try` block, after `void reloadProducts();` (near line 179) add:
```ts
      if (method === 'credit') void reloadCustomers();
```
Finally extend the `handleComplete` dependency array (near line 186) from:
```ts
  }, [items, loading, method, cardType, cashReceived, userId, username, oversoldKeys, clearCart, reloadProducts]);
```
to:
```ts
  }, [items, loading, method, cardType, cashReceived, userId, username, oversoldKeys, clearCart, reloadProducts, selectedCustomerId, creditPaidAmount, creditPaymentMethod, reloadCustomers]);
```

8. Pass the `credit` bundle to `<PaymentModal>` (near line 306). Change:
```tsx
      <PaymentModal
        open={showPayment}
        total={finalTotal}
        method={method}
        onMethod={setMethod}
        cardType={cardType}
        onCardType={setCardType}
        cashReceived={cashReceived}
        onCashReceived={setCashReceived}
        loading={loading}
        onConfirm={handleComplete}
        onClose={() => setShowPayment(false)}
      />
```
to:
```tsx
      <PaymentModal
        open={showPayment}
        total={finalTotal}
        method={method}
        onMethod={setMethod}
        cardType={cardType}
        onCardType={setCardType}
        cashReceived={cashReceived}
        onCashReceived={setCashReceived}
        loading={loading}
        onConfirm={handleComplete}
        onClose={() => setShowPayment(false)}
        credit={{
          customers: creditCustomers,
          search: customerSearch,
          onSearch: setCustomerSearch,
          selectedCustomerId,
          onSelect: setSelectedCustomerId,
          qcName,
          onQcName: setQcName,
          qcPhone,
          onQcPhone: setQcPhone,
          qcDescription,
          onQcDescription: setQcDescription,
          creatingCustomer,
          onCreateCustomer: handleCreateCustomer,
          paidAmount: creditPaidAmount,
          onPaidAmount: setCreditPaidAmount,
          paymentMethod: creditPaymentMethod,
          onPaymentMethod: setCreditPaymentMethod,
        }}
      />
```

9. Run the gates and see them PASS:
```
npx tsc --noEmit
npx vitest run
```
Expected: `tsc` exits 0; the full cashier suite is green (no regressions).

10. Commit:
```
git add src/pages/POSPage.tsx
git commit -m "feat(cashier): wire credit customer state + quick-create through POSPage"
```

---

### Task 6: «В долг» `PaymentChip` variant

**Files:**
- `src/components/history/__tests__/PaymentChip.test.tsx` (modify)
- `src/components/history/PaymentChip.tsx` (modify)

1. Write the failing test. Append these cases inside the existing `describe('PaymentChip', …)` in `src/components/history/__tests__/PaymentChip.test.tsx`:
```tsx
  it('renders the credit (В долг) variant', () => {
    render(<PaymentChip method="credit" />);
    expect(screen.getByText(/В долг/)).toBeInTheDocument();
  });
  it('is case-insensitive for credit', () => {
    render(<PaymentChip method="CREDIT" />);
    expect(screen.getByText(/В долг/)).toBeInTheDocument();
  });
```

2. Run and see it FAIL:
```
npx vitest run src/components/history/__tests__/PaymentChip.test.tsx
```
Expected: FAIL — `method="credit"` falls through to the default cash branch, so `/В долг/` is not found.

3. Implement. In `src/components/history/PaymentChip.tsx`, add a `credit` branch. Change:
```tsx
  } else if (m === 'mobile') {
    label = '📱 Мобильный';
    cls = 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300';
  }
```
to:
```tsx
  } else if (m === 'mobile') {
    label = '📱 Мобильный';
    cls = 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300';
  } else if (m === 'credit') {
    label = '📝 В долг';
    cls = 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300';
  }
```

4. Run and see it PASS:
```
npx vitest run src/components/history/__tests__/PaymentChip.test.tsx
```
Expected: 5 tests PASS.

5. Commit:
```
git add src/components/history/PaymentChip.tsx src/components/history/__tests__/PaymentChip.test.tsx
git commit -m "feat(cashier): add В долг variant to history PaymentChip"
```

---

### Task 7: Credit/debt summary in `SaleDetailPanel`

**Files:**
- `src/components/history/__tests__/SaleDetailPanel.test.tsx` (modify)
- `src/components/history/SaleDetailPanel.tsx` (modify)

1. Update the test. In `src/components/history/__tests__/SaleDetailPanel.test.tsx`, extend the hoisted mocks + module mock to include `getCustomerByClientId`, and add a credit case.

Change the hoisted block:
```tsx
const { mockGetSaleWithItems, mockGetProductById, mockRequestSync } = vi.hoisted(() => ({
  mockGetSaleWithItems: vi.fn(),
  mockGetProductById: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getSaleWithItems: mockGetSaleWithItems,
  getProductById: mockGetProductById,
}));
```
to:
```tsx
const { mockGetSaleWithItems, mockGetProductById, mockGetCustomerByClientId, mockRequestSync } = vi.hoisted(() => ({
  mockGetSaleWithItems: vi.fn(),
  mockGetProductById: vi.fn(),
  mockGetCustomerByClientId: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getSaleWithItems: mockGetSaleWithItems,
  getProductById: mockGetProductById,
  getCustomerByClientId: mockGetCustomerByClientId,
}));
```
Then append this case inside the `describe('SaleDetailPanel', …)` block:
```tsx
  it('shows a credit/debt summary with the customer name for a В долг sale', async () => {
    mockGetSaleWithItems.mockResolvedValue(
      saleWithDeletedProduct({
        payment_method: 'credit',
        customer_client_id: 'cust-1',
        total_amount: 100,
        paid_amount: 30,
        sync_status: 'synced',
        error_kind: null,
        server_sale_id: 700,
        synced_at: '2026-07-11T10:00:00.000Z',
      }),
    );
    mockGetCustomerByClientId.mockResolvedValue({ name: 'Иван Должник' });
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    expect(await screen.findByText('Иван Должник')).toBeInTheDocument();
    expect(screen.getByText('Продажа в долг')).toBeInTheDocument();
    expect(screen.getByText('Осталось')).toBeInTheDocument();
  });
```

2. Run and see it FAIL:
```
npx vitest run src/components/history/__tests__/SaleDetailPanel.test.tsx
```
Expected: FAIL — the panel renders no `Продажа в долг` block, and `getCustomerByClientId` is never called, so `Иван Должник` is not found.

3. Implement. Edit `src/components/history/SaleDetailPanel.tsx`.

3a. Extend the db import. Change:
```tsx
import { getSaleWithItems } from '../../lib/db';
```
to:
```tsx
import { getSaleWithItems, getCustomerByClientId } from '../../lib/db';
```

3b. Add customer-name state + a loader effect. After the existing `const [retrying, setRetrying] = useState(false);` add:
```tsx
  const [customerName, setCustomerName] = useState<string | null>(null);
```
After the existing `useEffect` that loads the sale (the block ending `}, [saleId]);`) add:
```tsx
  useEffect(() => {
    let cancelled = false;
    if (!sale || sale.payment_method !== 'credit' || !sale.customer_client_id) {
      setCustomerName(null);
      return;
    }
    getCustomerByClientId(sale.customer_client_id).then((c) => {
      if (!cancelled) setCustomerName(c?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [sale]);
```

3c. Render the credit summary. Directly after the closing `</div>` of the Totals box (the block that ends after the cash `Получено`/`Сдача` fragment, i.e. immediately before the `{/* Sync-state box */}` comment) insert:
```tsx
          {/* Credit/debt summary (derived locally) */}
          {sale.payment_method === 'credit' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-900/20">
              <p className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">Продажа в долг</p>
              {customerName && (
                <div className="mt-1 flex justify-between text-[13px] text-amber-700 dark:text-amber-300">
                  <span>Клиент</span>
                  <span className="font-medium">{customerName}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between text-[13px] text-amber-700 dark:text-amber-300">
                <span>Сумма</span>
                <span className="tabular-nums">{formatCurrency(sale.total_amount)}</span>
              </div>
              <div className="mt-1 flex justify-between text-[13px] text-amber-700 dark:text-amber-300">
                <span>Оплачено</span>
                <span className="tabular-nums">{formatCurrency(sale.paid_amount)}</span>
              </div>
              <div className="mt-1 flex justify-between text-[13px] font-bold text-red-600">
                <span>Осталось</span>
                <span className="tabular-nums">{formatCurrency(sale.total_amount - sale.paid_amount)}</span>
              </div>
            </div>
          )}
```

4. Run and see it PASS:
```
npx vitest run src/components/history/__tests__/SaleDetailPanel.test.tsx
npx tsc --noEmit
```
Expected: all `SaleDetailPanel` tests PASS (existing 3 + new 1); `tsc` exits 0.

5. Commit:
```
git add src/components/history/SaleDetailPanel.tsx src/components/history/__tests__/SaleDetailPanel.test.tsx
git commit -m "feat(cashier): show local credit/debt summary in SaleDetailPanel"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

1. Run the whole cashier suite and the typecheck gate together:
```
npx vitest run
npx tsc --noEmit
```
Expected: every test file green (including the untouched Phase-1 suites); `tsc` exits 0.

2. If anything is red, fix the offending task before proceeding — do not paper over it. When green, this feature's cashier UI slice (spec §5.1, §5.3) is complete.

No commit for this task unless a fix was required (commit the fix under the relevant task's message).

---

## Notes on scope boundaries

- This plan does **not** touch the sync engine, migration `003`, or any DAO — those belong to data-model and sync plans. The credit sale rides the existing Phase-1 outbox unchanged (`insertSale` → `getSendableSales` → `POST /api/sync/sales`).
- The Customers screen (spec §5.2) and debt-repayment UI are **out of scope** for this plan (separate plan). This plan only enables selling on credit + selecting/creating a customer at checkout + reading the debt summary in History.
- All money math reuses `posPricing` (DRY): `calculateCreditInitialPayment` for the split, `calculatePosPricing` for the total. The remaining debt shown offline (`total − paid`) is a display value; the server recomputes authoritatively via `record_credit_sale`.
