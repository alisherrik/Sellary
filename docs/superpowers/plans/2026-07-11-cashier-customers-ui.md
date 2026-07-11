# Cashier Offline Customers Screen (`/customers`) Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Ship the offline Customers screen for the Tauri cashier (spec §5.2): a new `/customers` route + a «Клиенты» nav link in the POS header, backed by a `CustomersPage` composed of small, individually-tested components (`CustomerList`, `CustomerDetail`, `DebtPaymentModal`, `DebtFilterTabs`) that read the local-first customer DAOs and let the cashier accept a debt repayment fully offline (it enters the `customer_payments` outbox). Debt shown is the locally-derived balance (server value at last pull + Σ unsynced credit − Σ unsynced payments, §2.4).

**Architecture:** Pure presentational components under `src/components/customers/` + one screen under `src/pages/`. All data comes through the data-model plan's `db.ts` DAOs (`getCustomersWithLocalBalance`, `getCustomerLedgerLocal`, `insertCustomerPayment`) — this plan never touches SQL, migrations, or the sync engine. Debt filtering/search is a pure, unit-tested function (`customerFilter.ts`). Recording a payment calls `insertCustomerPayment` (outbox insert), then the screen re-fetches customers so the derived local debt drops immediately (optimistic-by-refetch, mirroring the POS pay path). Reuses the existing `formatCurrency` and `SyncStatusBadge`; matches the web `/customers` Tailwind/Heroicons/`tabular-nums` look.

**Tech Stack:** React 19, TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), Tailwind, `@heroicons/react/24/outline`, `react-router-dom` v7, `react-hot-toast`, vitest + `@testing-library/react` (jsdom). Node 24 in CI.

**Depends on:**
- **data-model (Phase 2)** — provides the `db.ts` customer DAOs + types consumed here **by exact name** (`getCustomersWithLocalBalance`, `getCustomerLedgerLocal`, `insertCustomerPayment`, and the `CustomerWithBalance` / `LocalLedgerEntry` / `NewCustomerPaymentInput` types, plus `SyncStatus` / `ErrorKind` already exported in Phase 1). This plan mocks `../lib/db` in every component test, so it is buildable and testable independently, but `npx tsc --noEmit` (final gate) requires the data-model DAOs to be merged first. See **Interface assumptions** at the bottom.
- **credit-sync** — optional. The `SyncStatusBadge` this screen shows for unsynced customers/ledger rows and the background retry are owned there; nothing in this plan blocks on it.

The exact assumed `db.ts` surface (must match the data-model plan verbatim):

```ts
// From the data-model (Phase 2) plan — consumed here, NOT defined here.
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'; // already in Phase 1
export type ErrorKind = 'transient' | 'permanent';                    // already in Phase 1

export interface LocalCustomer {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  balance: number;            // server-derived debt at last pull
  is_active: number;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  created_at_client: string;
  synced_at: string | null;
  updated_at: string;
}

// Row + read-time derived local debt (§2.4): balance + Σ unsynced credit remaining − Σ unsynced payments.
// EXACT field set (contract C-1) — do NOT extend LocalCustomer or add timestamp fields.
export interface CustomerWithBalance {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  local_balance: number;
  is_active: number;
  sync_status: string;
  error_kind: string | null;
}

// One local operation for a customer (credit sale OR payment), newest first (contract C-4).
export interface LocalLedgerEntry {
  ref_id: string;                       // client_sale_id | client_payment_id (list key)
  kind: 'credit_sale' | 'payment';
  amount: number;                        // SIGNED: credit_sale = +remaining (debt); payment = −amount
  description: string | null;
  receipt_no: number | null;             // set for credit_sale, null for payment
  applied_amount: number | null;         // payment: server-applied portion (null until synced; < |amount| when capped/overpaid)
  created_at_client: string;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
}

export interface NewCustomerPaymentInput {
  customer_client_id: string;
  amount: number;
  payment_method: 'cash' | 'card' | 'mobile';
  description: string | null;
}

export function getCustomersWithLocalBalance(): Promise<CustomerWithBalance[]>; // all active, sorted by name
export function getCustomerLedgerLocal(clientCustomerId: string): Promise<LocalLedgerEntry[]>;
export function insertCustomerPayment(input: NewCustomerPaymentInput): Promise<{ clientPaymentId: string }>;
// insertCustomerPayment generates client_payment_id + idempotency_key + created_at_client internally.
```

---

## File Structure

**Create**
- `sellary-cashier/src/components/customers/customerFilter.ts` — pure debt-tab + search filtering (`DebtFilter`, `hasDebt`, `debtCounts`, `filterCustomers`).
- `sellary-cashier/src/components/customers/DebtFilterTabs.tsx` — segmented Все / Есть долг / Нет долга tabs with counts (pure).
- `sellary-cashier/src/components/customers/CustomerList.tsx` — search box + `DebtFilterTabs` + customer cards (name/phone, red local debt, `SyncStatusBadge` for unsynced).
- `sellary-cashier/src/components/customers/DebtPaymentModal.tsx` — «Оплата долга» form → `insertCustomerPayment`.
- `sellary-cashier/src/components/customers/CustomerDetail.tsx` — current local debt, local ledger view, «Принять оплату долга» (disabled when local debt ≤ 0).
- `sellary-cashier/src/pages/CustomersPage.tsx` — screen: loads customers, derives counts/visible list, composes List + Detail, header back-to-Касса.
- `sellary-cashier/src/components/customers/__tests__/customerFilter.test.ts`
- `sellary-cashier/src/components/customers/__tests__/DebtFilterTabs.test.tsx`
- `sellary-cashier/src/components/customers/__tests__/CustomerList.test.tsx`
- `sellary-cashier/src/components/customers/__tests__/DebtPaymentModal.test.tsx`
- `sellary-cashier/src/components/customers/__tests__/CustomerDetail.test.tsx`
- `sellary-cashier/src/pages/__tests__/CustomersPage.test.tsx`

**Modify**
- `sellary-cashier/src/App.tsx` — ADD one `import` + one `<Route path="/customers" …>` line. **Do NOT rewrite the file.** App.tsx is owned by the offline-auth plan (its header comment says downstream plans must not rewrite it); this single additive route line is a coordinated exception explicitly scoped to Phase 2.
- `sellary-cashier/src/pages/POSPage.tsx` — add a «Клиенты» nav button in the header, next to «История» (nav link inside this screen only, per the App.tsx contract).

---

## Task 1: Pure debt filter/search helper (`customerFilter.ts`)

**Files:**
- Create: `sellary-cashier/src/components/customers/customerFilter.ts`
- Create: `sellary-cashier/src/components/customers/__tests__/customerFilter.test.ts`

- [ ] **Write the failing test** `sellary-cashier/src/components/customers/__tests__/customerFilter.test.ts` (fails now: the module does not exist):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { debtCounts, filterCustomers, hasDebt } from '../customerFilter';
  import type { CustomerWithBalance } from '../../../lib/db';

  function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
    return {
      client_customer_id: over.client_customer_id ?? 'c1',
      server_id: over.server_id ?? null,
      name: over.name ?? 'Иван Петров',
      phone: over.phone ?? null,
      email: null,
      address: null,
      description: over.description ?? null,
      is_active: 1,
      sync_status: over.sync_status ?? 'synced',
      error_kind: over.error_kind ?? null,
      local_balance: over.local_balance ?? 0,
    };
  }

  describe('customerFilter', () => {
    it('hasDebt is true only for a positive local balance', () => {
      expect(hasDebt(cust({ local_balance: 100 }))).toBe(true);
      expect(hasDebt(cust({ local_balance: 0 }))).toBe(false);
      expect(hasDebt(cust({ local_balance: -50 }))).toBe(false);
    });

    it('debtCounts splits the list into all / debt / clear', () => {
      const list = [
        cust({ client_customer_id: 'a', local_balance: 500 }),
        cust({ client_customer_id: 'b', local_balance: 0 }),
        cust({ client_customer_id: 'c', local_balance: 1200 }),
      ];
      expect(debtCounts(list)).toEqual({ all: 3, debt: 2, clear: 1 });
    });

    it('filters by the debt tab', () => {
      const list = [
        cust({ client_customer_id: 'a', local_balance: 500 }),
        cust({ client_customer_id: 'b', local_balance: 0 }),
      ];
      expect(filterCustomers(list, 'debt', '').map((c) => c.client_customer_id)).toEqual(['a']);
      expect(filterCustomers(list, 'clear', '').map((c) => c.client_customer_id)).toEqual(['b']);
      expect(filterCustomers(list, 'all', '').map((c) => c.client_customer_id)).toEqual(['a', 'b']);
    });

    it('searches case-insensitively over name, phone and description', () => {
      const list = [
        cust({ client_customer_id: 'a', name: 'Иван Петров', phone: '901112233' }),
        cust({ client_customer_id: 'b', name: 'Ольга', description: 'магазин на углу' }),
      ];
      expect(filterCustomers(list, 'all', 'петров').map((c) => c.client_customer_id)).toEqual(['a']);
      expect(filterCustomers(list, 'all', '9011').map((c) => c.client_customer_id)).toEqual(['a']);
      expect(filterCustomers(list, 'all', 'УГЛУ').map((c) => c.client_customer_id)).toEqual(['b']);
      expect(filterCustomers(list, 'all', 'нет-такого')).toEqual([]);
    });
  });
  ```

- [ ] **Run it and see it FAIL.** From `sellary-cashier/`:
  ```
  npx vitest run src/components/customers/__tests__/customerFilter.test.ts
  ```
  Expected failure: `Failed to resolve import "../customerFilter"` (module missing).

- [ ] **Create `sellary-cashier/src/components/customers/customerFilter.ts`:**
  ```ts
  import type { CustomerWithBalance } from '../../lib/db';

  export type DebtFilter = 'all' | 'debt' | 'clear';

  /** A customer owes money iff their read-time derived local balance is positive (§2.4). */
  export function hasDebt(c: CustomerWithBalance): boolean {
    return Number(c.local_balance || 0) > 0;
  }

  /** Tab counts over the FULL list (not the currently-visible subset). */
  export function debtCounts(list: CustomerWithBalance[]): { all: number; debt: number; clear: number } {
    let debt = 0;
    for (const c of list) if (hasDebt(c)) debt += 1;
    return { all: list.length, debt, clear: list.length - debt };
  }

  /** Apply the active debt tab + a free-text search over name/phone/description. */
  export function filterCustomers(
    list: CustomerWithBalance[],
    filter: DebtFilter,
    search: string,
  ): CustomerWithBalance[] {
    const q = search.trim().toLowerCase();
    return list.filter((c) => {
      if (filter === 'debt' && !hasDebt(c)) return false;
      if (filter === 'clear' && hasDebt(c)) return false;
      if (q) {
        const hay = `${c.name} ${c.phone ?? ''} ${c.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/components/customers/__tests__/customerFilter.test.ts
  ```
  All four cases green.

- [ ] **Typecheck gate:**
  ```
  npx tsc --noEmit
  ```
  Exit 0 (assumes the data-model `CustomerWithBalance` export is present; see Interface assumptions).

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/components/customers/customerFilter.ts \
          sellary-cashier/src/components/customers/__tests__/customerFilter.test.ts
  git commit -m "feat(cashier): pure debt-tab + search filter for the customers screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: `DebtFilterTabs` segmented control

**Files:**
- Create: `sellary-cashier/src/components/customers/DebtFilterTabs.tsx`
- Create: `sellary-cashier/src/components/customers/__tests__/DebtFilterTabs.test.tsx`

- [ ] **Write the failing test** `sellary-cashier/src/components/customers/__tests__/DebtFilterTabs.test.tsx`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { DebtFilterTabs } from '../DebtFilterTabs';

  describe('DebtFilterTabs', () => {
    it('renders the three labels with their counts', () => {
      render(<DebtFilterTabs value="all" onChange={() => {}} counts={{ all: 5, debt: 2, clear: 3 }} />);
      expect(screen.getByText('Все')).toBeInTheDocument();
      expect(screen.getByText('Есть долг')).toBeInTheDocument();
      expect(screen.getByText('Нет долга')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('fires onChange with the tab key when a tab is clicked', () => {
      const onChange = vi.fn();
      render(<DebtFilterTabs value="all" onChange={onChange} counts={{ all: 1, debt: 1, clear: 0 }} />);
      fireEvent.click(screen.getByText('Есть долг'));
      expect(onChange).toHaveBeenCalledWith('debt');
    });

    it('marks the active tab with the white pill class', () => {
      const { container } = render(
        <DebtFilterTabs value="debt" onChange={() => {}} counts={{ all: 1, debt: 1, clear: 0 }} />,
      );
      const active = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Есть долг'));
      expect(active?.className).toContain('bg-white');
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/components/customers/__tests__/DebtFilterTabs.test.tsx
  ```
  Expected failure: `Failed to resolve import "../DebtFilterTabs"`.

- [ ] **Create `sellary-cashier/src/components/customers/DebtFilterTabs.tsx`:**
  ```tsx
  import type { DebtFilter } from './customerFilter';

  interface Tab {
    key: DebtFilter;
    label: string;
    count: number;
  }

  export function DebtFilterTabs({
    value,
    onChange,
    counts,
  }: {
    value: DebtFilter;
    onChange: (f: DebtFilter) => void;
    counts: { all: number; debt: number; clear: number };
  }) {
    const tabs: Tab[] = [
      { key: 'all', label: 'Все', count: counts.all },
      { key: 'debt', label: 'Есть долг', count: counts.debt },
      { key: 'clear', label: 'Нет долга', count: counts.clear },
    ];
    return (
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-label={tab.label}
            onClick={() => onChange(tab.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              value === tab.key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            <span>{tab.label}</span>
            <span className="text-xs tabular-nums text-gray-400">{tab.count}</span>
          </button>
        ))}
      </div>
    );
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/components/customers/__tests__/DebtFilterTabs.test.tsx
  ```
  All three cases green.

- [ ] **Typecheck gate:**
  ```
  npx tsc --noEmit
  ```
  Exit 0.

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/components/customers/DebtFilterTabs.tsx \
          sellary-cashier/src/components/customers/__tests__/DebtFilterTabs.test.tsx
  git commit -m "feat(cashier): DebtFilterTabs segmented control for the customers screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: `CustomerList` (search + tabs + debt cards)

**Files:**
- Create: `sellary-cashier/src/components/customers/CustomerList.tsx`
- Create: `sellary-cashier/src/components/customers/__tests__/CustomerList.test.tsx`

`CustomerList` is presentational: it receives the already-visible customers plus tab counts and callbacks; the page (Task 6) owns state + filtering. It imports only the `CustomerWithBalance` **type** from `db.ts` (erased at compile), so its test needs no `db` mock.

- [ ] **Write the failing test** `sellary-cashier/src/components/customers/__tests__/CustomerList.test.tsx`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { CustomerList } from '../CustomerList';
  import type { CustomerWithBalance } from '../../../lib/db';

  function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
    return {
      client_customer_id: over.client_customer_id ?? 'c1',
      server_id: over.server_id ?? null,
      name: over.name ?? 'Иван',
      phone: over.phone ?? null,
      email: null,
      address: null,
      description: over.description ?? null,
      is_active: 1,
      sync_status: over.sync_status ?? 'synced',
      error_kind: over.error_kind ?? null,
      local_balance: over.local_balance ?? 0,
    };
  }

  const noop = () => {};

  describe('CustomerList', () => {
    it('renders a positive local debt in red and a sync badge for unsynced customers', () => {
      const { container } = render(
        <CustomerList
          customers={[cust({ client_customer_id: 'c1', name: 'Иван', phone: '901112233', local_balance: 5000, sync_status: 'pending' })]}
          selectedClientId={null}
          onSelect={noop}
          search=""
          onSearch={noop}
          filter="all"
          onFilter={noop}
          counts={{ all: 1, debt: 1, clear: 0 }}
          loading={false}
        />,
      );
      expect(screen.getByText('901112233')).toBeInTheDocument();
      const debt = container.querySelector('.text-red-600');
      expect(debt).not.toBeNull();
      expect(debt?.textContent ?? '').toMatch(/5/);
      // SyncStatusBadge for a pending row renders "Ожидает"
      expect(screen.getByText('Ожидает')).toBeInTheDocument();
    });

    it('does not render a sync badge for a synced customer and greys a zero balance', () => {
      const { container } = render(
        <CustomerList
          customers={[cust({ client_customer_id: 'c2', name: 'Ольга', local_balance: 0, sync_status: 'synced' })]}
          selectedClientId={null}
          onSelect={noop}
          search=""
          onSearch={noop}
          filter="all"
          onFilter={noop}
          counts={{ all: 1, debt: 0, clear: 1 }}
          loading={false}
        />,
      );
      expect(screen.queryByText('Ожидает')).not.toBeInTheDocument();
      expect(container.querySelector('.text-red-600')).toBeNull();
      expect(container.querySelector('.text-gray-400')).not.toBeNull();
    });

    it('calls onSelect with the clicked customer', () => {
      const onSelect = vi.fn();
      render(
        <CustomerList
          customers={[cust({ client_customer_id: 'c9', name: 'Пётр' })]}
          selectedClientId={null}
          onSelect={onSelect}
          search=""
          onSearch={noop}
          filter="all"
          onFilter={noop}
          counts={{ all: 1, debt: 0, clear: 1 }}
          loading={false}
        />,
      );
      fireEvent.click(screen.getByText('Пётр'));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0][0].client_customer_id).toBe('c9');
    });

    it('propagates the search box value', () => {
      const onSearch = vi.fn();
      render(
        <CustomerList
          customers={[]}
          selectedClientId={null}
          onSelect={noop}
          search=""
          onSearch={onSearch}
          filter="all"
          onFilter={noop}
          counts={{ all: 0, debt: 0, clear: 0 }}
          loading={false}
        />,
      );
      fireEvent.change(screen.getByLabelText('Поиск клиентов'), { target: { value: 'ив' } });
      expect(onSearch).toHaveBeenCalledWith('ив');
    });

    it('shows an empty state when there are no customers', () => {
      render(
        <CustomerList
          customers={[]}
          selectedClientId={null}
          onSelect={noop}
          search=""
          onSearch={noop}
          filter="all"
          onFilter={noop}
          counts={{ all: 0, debt: 0, clear: 0 }}
          loading={false}
        />,
      );
      expect(screen.getByText('Клиентов пока нет')).toBeInTheDocument();
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/components/customers/__tests__/CustomerList.test.tsx
  ```
  Expected failure: `Failed to resolve import "../CustomerList"`.

- [ ] **Create `sellary-cashier/src/components/customers/CustomerList.tsx`:**
  ```tsx
  import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
  import type { CustomerWithBalance } from '../../lib/db';
  import { formatCurrency } from '../../lib/format';
  import { SyncStatusBadge } from '../history/SyncStatusBadge';
  import { DebtFilterTabs } from './DebtFilterTabs';
  import type { DebtFilter } from './customerFilter';

  export function CustomerList({
    customers,
    selectedClientId,
    onSelect,
    search,
    onSearch,
    filter,
    onFilter,
    counts,
    loading,
  }: {
    customers: CustomerWithBalance[];
    selectedClientId: string | null;
    onSelect: (c: CustomerWithBalance) => void;
    search: string;
    onSearch: (v: string) => void;
    filter: DebtFilter;
    onFilter: (f: DebtFilter) => void;
    counts: { all: number; debt: number; clear: number };
    loading: boolean;
  }) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="space-y-3 border-b border-gray-100 p-3 dark:border-gray-700">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              aria-label="Поиск клиентов"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Поиск по имени или телефону…"
              className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
          <DebtFilterTabs value={filter} onChange={onFilter} counts={counts} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Загрузка клиентов…</div>
          ) : customers.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">Клиентов пока нет</div>
          ) : (
            <div className="space-y-2">
              {customers.map((c) => {
                const selected = c.client_customer_id === selectedClientId;
                const balance = Number(c.local_balance || 0);
                return (
                  <button
                    key={c.client_customer_id}
                    type="button"
                    onClick={() => onSelect(c)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
                        : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gray-900 text-sm font-black text-white">
                      {(c.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-gray-900 dark:text-white">{c.name}</p>
                      {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
                      {c.sync_status !== 'synced' && (
                        <span className="mt-1 inline-block">
                          <SyncStatusBadge syncStatus={c.sync_status} errorKind={c.error_kind} />
                        </span>
                      )}
                    </div>
                    <span className={`shrink-0 font-black tabular-nums ${balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {formatCurrency(balance)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/components/customers/__tests__/CustomerList.test.tsx
  ```
  All five cases green.

- [ ] **Typecheck gate:**
  ```
  npx tsc --noEmit
  ```
  Exit 0.

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/components/customers/CustomerList.tsx \
          sellary-cashier/src/components/customers/__tests__/CustomerList.test.tsx
  git commit -m "feat(cashier): CustomerList with debt cards, search and sync badges

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: `DebtPaymentModal` (record a debt repayment into the outbox)

**Files:**
- Create: `sellary-cashier/src/components/customers/DebtPaymentModal.tsx`
- Create: `sellary-cashier/src/components/customers/__tests__/DebtPaymentModal.test.tsx`

- [ ] **Write the failing test** `sellary-cashier/src/components/customers/__tests__/DebtPaymentModal.test.tsx`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';

  const { mockInsertCustomerPayment } = vi.hoisted(() => ({ mockInsertCustomerPayment: vi.fn() }));
  vi.mock('../../../lib/db', () => ({ insertCustomerPayment: mockInsertCustomerPayment }));
  vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

  import { DebtPaymentModal } from '../DebtPaymentModal';
  import type { CustomerWithBalance } from '../../../lib/db';

  function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
    return {
      client_customer_id: over.client_customer_id ?? 'c1',
      server_id: null,
      name: over.name ?? 'Иван',
      phone: null,
      email: null,
      address: null,
      description: null,
      is_active: 1,
      sync_status: 'synced',
      error_kind: null,
      local_balance: over.local_balance ?? 10000,
    };
  }

  describe('DebtPaymentModal', () => {
    it('inserts a payment into the outbox and calls onSaved', async () => {
      mockInsertCustomerPayment.mockResolvedValue({ clientPaymentId: 'p1' });
      const onSaved = vi.fn();
      render(<DebtPaymentModal customer={cust()} onClose={() => {}} onSaved={onSaved} />);

      fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '3000' } });
      fireEvent.change(screen.getByLabelText('Способ оплаты'), { target: { value: 'card' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(mockInsertCustomerPayment).toHaveBeenCalledWith({
        customer_client_id: 'c1',
        amount: 3000,
        payment_method: 'card',
        description: null,
      });
    });

    it('trims a description and passes it through', async () => {
      mockInsertCustomerPayment.mockResolvedValue({ clientPaymentId: 'p2' });
      render(<DebtPaymentModal customer={cust()} onClose={() => {}} onSaved={() => {}} />);
      fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '1000' } });
      fireEvent.change(screen.getByLabelText('Примечание'), { target: { value: '  за муку  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
      await waitFor(() => expect(mockInsertCustomerPayment).toHaveBeenCalled());
      expect(mockInsertCustomerPayment.mock.calls[0][0].description).toBe('за муку');
    });

    it('rejects a non-positive amount and never inserts', async () => {
      const onSaved = vi.fn();
      render(<DebtPaymentModal customer={cust()} onClose={() => {}} onSaved={onSaved} />);
      fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
      await Promise.resolve();
      expect(mockInsertCustomerPayment).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('rejects an amount greater than the current local debt', async () => {
      const onSaved = vi.fn();
      render(<DebtPaymentModal customer={cust({ local_balance: 5000 })} onClose={() => {}} onSaved={onSaved} />);
      fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
      await Promise.resolve();
      expect(mockInsertCustomerPayment).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('calls onClose from the cancel button', () => {
      const onClose = vi.fn();
      render(<DebtPaymentModal customer={cust()} onClose={onClose} onSaved={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/components/customers/__tests__/DebtPaymentModal.test.tsx
  ```
  Expected failure: `Failed to resolve import "../DebtPaymentModal"`.

- [ ] **Create `sellary-cashier/src/components/customers/DebtPaymentModal.tsx`:**
  ```tsx
  import { useState } from 'react';
  import toast from 'react-hot-toast';
  import type { CustomerWithBalance } from '../../lib/db';
  import { insertCustomerPayment } from '../../lib/db';
  import { formatCurrency } from '../../lib/format';

  type Method = 'cash' | 'card' | 'mobile';

  export function DebtPaymentModal({
    customer,
    onClose,
    onSaved,
  }: {
    customer: CustomerWithBalance;
    onClose: () => void;
    onSaved: () => void;
  }) {
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<Method>('cash');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    const debt = Number(customer.local_balance || 0);

    const save = async () => {
      const value = Number(amount);
      if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
        toast.error('Введите сумму оплаты');
        return;
      }
      if (value > debt) {
        toast.error('Сумма больше текущего долга');
        return;
      }
      setSaving(true);
      try {
        await insertCustomerPayment({
          customer_client_id: customer.client_customer_id,
          amount: value,
          payment_method: method,
          description: description.trim() || null,
        });
        toast.success('Оплата долга сохранена');
        onSaved();
      } catch (err) {
        console.error('insertCustomerPayment failed', err);
        toast.error('Не удалось сохранить оплату');
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
        <div className="w-full rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl">
          <h2 className="text-lg font-black text-gray-900 dark:text-white">Оплата долга</h2>
          <p className="mt-1 text-sm text-gray-500">{customer.name}</p>
          <p className="mt-1 text-sm text-gray-500">
            Текущий долг:{' '}
            <span className="font-bold tabular-nums text-red-600">{formatCurrency(debt)}</span>
          </p>

          <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Сумма оплаты
            <input
              type="text"
              inputMode="decimal"
              aria-label="Сумма оплаты"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-right text-lg font-bold tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
            />
          </label>

          <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Способ оплаты
            <select
              aria-label="Способ оплаты"
              value={method}
              onChange={(e) => setMethod(e.target.value as Method)}
              className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
            >
              <option value="cash">Наличные</option>
              <option value="card">Карта</option>
              <option value="mobile">Мобильный</option>
            </select>
          </label>

          <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Примечание
            <input
              type="text"
              aria-label="Примечание"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
            />
          </label>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-gray-400"
            >
              Сохранить оплату
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/components/customers/__tests__/DebtPaymentModal.test.tsx
  ```
  All five cases green.

- [ ] **Typecheck gate:**
  ```
  npx tsc --noEmit
  ```
  Exit 0.

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/components/customers/DebtPaymentModal.tsx \
          sellary-cashier/src/components/customers/__tests__/DebtPaymentModal.test.tsx
  git commit -m "feat(cashier): DebtPaymentModal records offline debt repayments to the outbox

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: `CustomerDetail` (local debt + local ledger + accept payment)

**Files:**
- Create: `sellary-cashier/src/components/customers/CustomerDetail.tsx`
- Create: `sellary-cashier/src/components/customers/__tests__/CustomerDetail.test.tsx`

The detail panel loads the customer's **local** ledger (unsynced credit sales + payments) via `getCustomerLedgerLocal`, re-loading whenever the client id **or** the derived `local_balance` changes (so it refreshes after a payment). «Принять оплату долга» is disabled when local debt ≤ 0. Recording a payment calls `onChanged` (the page refetches customers, which updates `local_balance` and thus re-loads the ledger).

**Capped/overpayment indicator (spec §9 Q3, contract coverage add):** when a ledger row is a **synced payment** whose `applied_amount != null && applied_amount < |amount|` (the server capped it to the outstanding debt), render an amber note «переплата не применена (учтено {applied_amount})» next to that row. `applied_amount` is null for unsynced/pending payments (no note) and for credit sales; a fully-applied synced payment (`applied_amount === |amount|`) shows no note. The immediate feedback is the credit-sync overpayment toast; this is the durable per-payment indicator.

- [ ] **Write the failing test** `sellary-cashier/src/components/customers/__tests__/CustomerDetail.test.tsx`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';

  const { mockGetLedger, mockInsertPayment } = vi.hoisted(() => ({
    mockGetLedger: vi.fn(),
    mockInsertPayment: vi.fn(),
  }));
  vi.mock('../../../lib/db', () => ({
    getCustomerLedgerLocal: mockGetLedger,
    insertCustomerPayment: mockInsertPayment,
  }));
  vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

  import { CustomerDetail } from '../CustomerDetail';
  import type { CustomerWithBalance } from '../../../lib/db';

  function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
    return {
      client_customer_id: over.client_customer_id ?? 'c1',
      server_id: null,
      name: over.name ?? 'Иван',
      phone: over.phone ?? '901112233',
      email: null,
      address: null,
      description: null,
      is_active: 1,
      sync_status: 'synced',
      error_kind: null,
      local_balance: over.local_balance ?? 8000,
    };
  }

  describe('CustomerDetail', () => {
    it('disables the payment action when there is no local debt', async () => {
      mockGetLedger.mockResolvedValue([]);
      render(<CustomerDetail customer={cust({ local_balance: 0 })} onChanged={() => {}} />);
      const btn = await screen.findByRole('button', { name: 'Принять оплату долга' });
      expect(btn).toBeDisabled();
    });

    it('renders the local ledger with debt (+) and payment (−) signs', async () => {
      mockGetLedger.mockResolvedValue([
        { ref_id: 's1', kind: 'credit_sale', amount: 5000, description: null, receipt_no: 42, applied_amount: null, created_at_client: '2026-07-11T09:00:00.000Z', sync_status: 'pending', error_kind: null },
        { ref_id: 'p1', kind: 'payment', amount: -2000, description: 'частично', receipt_no: null, applied_amount: null, created_at_client: '2026-07-11T10:00:00.000Z', sync_status: 'pending', error_kind: null },
      ]);
      render(<CustomerDetail customer={cust({ local_balance: 3000 })} onChanged={() => {}} />);
      expect(await screen.findByText('Продажа в долг · чек #42')).toBeInTheDocument();
      expect(screen.getByText('Оплата долга')).toBeInTheDocument();
      expect(screen.getByText('частично')).toBeInTheDocument();
      // both ledger rows are unsynced → each shows a badge
      expect(screen.getAllByText('Ожидает')).toHaveLength(2);
    });

    it('shows an amber "переплата не применена" note only on a capped synced payment', async () => {
      mockGetLedger.mockResolvedValue([
        // capped: paid 5000 but server applied only 3000 → amber note
        { ref_id: 'p-cap', kind: 'payment', amount: -5000, description: null, receipt_no: null, applied_amount: 3000, created_at_client: '2026-07-11T11:00:00.000Z', sync_status: 'synced', error_kind: null },
        // fully applied synced payment → no note
        { ref_id: 'p-full', kind: 'payment', amount: -2000, description: null, receipt_no: null, applied_amount: 2000, created_at_client: '2026-07-11T10:00:00.000Z', sync_status: 'synced', error_kind: null },
        // unsynced payment (applied_amount null) → no note
        { ref_id: 'p-pend', kind: 'payment', amount: -1000, description: null, receipt_no: null, applied_amount: null, created_at_client: '2026-07-11T09:00:00.000Z', sync_status: 'pending', error_kind: null },
      ]);
      render(<CustomerDetail customer={cust({ local_balance: 0 })} onChanged={() => {}} />);
      // exactly one amber note, carrying the applied amount (3000)
      const notes = await screen.findAllByText(/переплата не применена/);
      expect(notes).toHaveLength(1);
      expect(notes[0].textContent ?? '').toMatch(/3/);
    });

    it('shows an empty-ledger note when there are no unsynced operations', async () => {
      mockGetLedger.mockResolvedValue([]);
      render(<CustomerDetail customer={cust({ local_balance: 3000 })} onChanged={() => {}} />);
      expect(await screen.findByText('Нет несинхронизированных операций')).toBeInTheDocument();
    });

    it('records a debt payment and calls onChanged', async () => {
      mockGetLedger.mockResolvedValue([]);
      mockInsertPayment.mockResolvedValue({ clientPaymentId: 'p1' });
      const onChanged = vi.fn();
      render(<CustomerDetail customer={cust({ local_balance: 8000 })} onChanged={onChanged} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Принять оплату долга' }));
      fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '4000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(mockInsertPayment).toHaveBeenCalledWith({
        customer_client_id: 'c1',
        amount: 4000,
        payment_method: 'cash',
        description: null,
      });
    });

    it('reloads the ledger when the derived local_balance changes', async () => {
      mockGetLedger.mockResolvedValue([]);
      const { rerender } = render(<CustomerDetail customer={cust({ local_balance: 8000 })} onChanged={() => {}} />);
      await waitFor(() => expect(mockGetLedger).toHaveBeenCalledTimes(1));
      rerender(<CustomerDetail customer={cust({ local_balance: 4000 })} onChanged={() => {}} />);
      await waitFor(() => expect(mockGetLedger).toHaveBeenCalledTimes(2));
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/components/customers/__tests__/CustomerDetail.test.tsx
  ```
  Expected failure: `Failed to resolve import "../CustomerDetail"`.

- [ ] **Create `sellary-cashier/src/components/customers/CustomerDetail.tsx`:**
  ```tsx
  import { useEffect, useState } from 'react';
  import type { CustomerWithBalance, LocalLedgerEntry } from '../../lib/db';
  import { getCustomerLedgerLocal } from '../../lib/db';
  import { formatCurrency } from '../../lib/format';
  import { SyncStatusBadge } from '../history/SyncStatusBadge';
  import { DebtPaymentModal } from './DebtPaymentModal';

  const entryLabels: Record<LocalLedgerEntry['kind'], string> = {
    credit_sale: 'Продажа в долг',
    payment: 'Оплата долга',
  };

  export function CustomerDetail({
    customer,
    onChanged,
  }: {
    customer: CustomerWithBalance;
    onChanged: () => void;
  }) {
    const [ledger, setLedger] = useState<LocalLedgerEntry[]>([]);
    const [loadingLedger, setLoadingLedger] = useState(true);
    const [showPayment, setShowPayment] = useState(false);

    const debt = Number(customer.local_balance || 0);

    // Reload on customer switch AND whenever the derived debt changes (i.e. after a payment).
    useEffect(() => {
      let cancelled = false;
      setLoadingLedger(true);
      getCustomerLedgerLocal(customer.client_customer_id).then((rows) => {
        if (!cancelled) {
          setLedger(rows);
          setLoadingLedger(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [customer.client_customer_id, customer.local_balance]);

    const handleSaved = () => {
      setShowPayment(false);
      onChanged();
    };

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-gray-100 p-4 dark:border-gray-700">
          <p className="text-xs uppercase tracking-wide text-gray-400">Выбранный клиент</p>
          <h2 className="mt-1 text-lg font-black text-gray-900 dark:text-white">{customer.name}</h2>
          {customer.phone && <p className="text-sm text-gray-500">{customer.phone}</p>}
          <div className="mt-3 rounded-2xl bg-red-50 p-3 dark:bg-red-900/20">
            <p className="text-xs text-red-500">Текущий долг</p>
            <p className="text-2xl font-black tabular-nums text-red-600">{formatCurrency(debt)}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowPayment(true)}
            disabled={debt <= 0}
            className="mt-3 w-full rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Принять оплату долга
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">История долга (локально)</p>
          {loadingLedger ? (
            <p className="py-6 text-center text-sm text-gray-400">Загрузка истории…</p>
          ) : ledger.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Нет несинхронизированных операций</p>
          ) : (
            <div className="space-y-2">
              {ledger.map((entry) => (
                <div key={entry.ref_id} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/50">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {entryLabels[entry.kind]}
                        {entry.kind === 'credit_sale' && entry.receipt_no != null ? ` · чек #${entry.receipt_no}` : ''}
                      </p>
                      {entry.description && <p className="truncate text-xs text-gray-400">{entry.description}</p>}
                      {entry.kind === 'payment' &&
                        entry.sync_status === 'synced' &&
                        entry.applied_amount != null &&
                        entry.applied_amount < Math.abs(entry.amount) && (
                          <p className="mt-0.5 text-xs font-medium text-amber-600">
                            переплата не применена (учтено {formatCurrency(entry.applied_amount)})
                          </p>
                        )}
                      <span className="mt-1 inline-block">
                        <SyncStatusBadge syncStatus={entry.sync_status} errorKind={entry.error_kind} />
                      </span>
                    </div>
                    <span className={`shrink-0 font-black tabular-nums ${entry.amount >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {entry.amount >= 0 ? '+' : ''}
                      {formatCurrency(entry.amount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showPayment && (
          <DebtPaymentModal customer={customer} onClose={() => setShowPayment(false)} onSaved={handleSaved} />
        )}
      </div>
    );
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/components/customers/__tests__/CustomerDetail.test.tsx
  ```
  All six cases green (incl. the capped-payment amber note).

- [ ] **Typecheck gate:**
  ```
  npx tsc --noEmit
  ```
  Exit 0.

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/components/customers/CustomerDetail.tsx \
          sellary-cashier/src/components/customers/__tests__/CustomerDetail.test.tsx
  git commit -m "feat(cashier): CustomerDetail with local ledger and accept-payment action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6: `CustomersPage` screen + wire the route + POS nav link

**Files:**
- Create: `sellary-cashier/src/pages/CustomersPage.tsx`
- Create: `sellary-cashier/src/pages/__tests__/CustomersPage.test.tsx`
- Modify: `sellary-cashier/src/App.tsx` (one import + one `<Route>` line)
- Modify: `sellary-cashier/src/pages/POSPage.tsx` (add «Клиенты» header button)

- [ ] **Write the failing test** `sellary-cashier/src/pages/__tests__/CustomersPage.test.tsx` (wraps in `MemoryRouter` because the page uses `useNavigate`; mocks `db` + toast):
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';
  import { MemoryRouter } from 'react-router-dom';

  const { mockGetCustomers, mockGetLedger, mockInsertPayment } = vi.hoisted(() => ({
    mockGetCustomers: vi.fn(),
    mockGetLedger: vi.fn(),
    mockInsertPayment: vi.fn(),
  }));
  vi.mock('../../lib/db', () => ({
    getCustomersWithLocalBalance: mockGetCustomers,
    getCustomerLedgerLocal: mockGetLedger,
    insertCustomerPayment: mockInsertPayment,
  }));
  vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

  import { CustomersPage } from '../CustomersPage';
  import type { CustomerWithBalance } from '../../lib/db';

  function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
    return {
      client_customer_id: over.client_customer_id ?? 'c1',
      server_id: null,
      name: over.name ?? 'Иван',
      phone: over.phone ?? null,
      email: null,
      address: null,
      description: null,
      is_active: 1,
      sync_status: over.sync_status ?? 'synced',
      error_kind: null,
      local_balance: over.local_balance ?? 0,
    };
  }

  function normDigits(t: string): string {
    return t.replace(/[\s  ]/g, '');
  }

  describe('CustomersPage', () => {
    it('loads customers and shows a positive debt', async () => {
      mockGetLedger.mockResolvedValue([]);
      mockGetCustomers.mockResolvedValue([cust({ client_customer_id: 'c1', name: 'Иван', local_balance: 10000 })]);
      render(
        <MemoryRouter>
          <CustomersPage />
        </MemoryRouter>,
      );
      // name shows in both the list card and the detail header
      expect((await screen.findAllByText('Иван')).length).toBeGreaterThanOrEqual(1);
      const debt = await screen.findAllByText((t) => normDigits(t).includes('10000'));
      expect(debt.length).toBeGreaterThanOrEqual(1);
    });

    it('records a payment and refetches so the shown debt drops', async () => {
      mockGetLedger.mockResolvedValue([]);
      mockInsertPayment.mockResolvedValue({ clientPaymentId: 'p1' });
      mockGetCustomers
        .mockResolvedValueOnce([cust({ client_customer_id: 'c1', name: 'Иван', local_balance: 10000 })])
        .mockResolvedValueOnce([cust({ client_customer_id: 'c1', name: 'Иван', local_balance: 6000 })]);
      render(
        <MemoryRouter>
          <CustomersPage />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Принять оплату долга' }));
      fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '4000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

      await waitFor(() => expect(mockGetCustomers).toHaveBeenCalledTimes(2));
      const dropped = await screen.findAllByText((t) => normDigits(t).includes('6000'));
      expect(dropped.length).toBeGreaterThanOrEqual(1);
      expect(mockInsertPayment).toHaveBeenCalledWith({
        customer_client_id: 'c1',
        amount: 4000,
        payment_method: 'cash',
        description: null,
      });
    });

    it('filters to only customers with debt via the "Есть долг" tab', async () => {
      mockGetLedger.mockResolvedValue([]);
      mockGetCustomers.mockResolvedValue([
        cust({ client_customer_id: 'c1', name: 'Должник', local_balance: 5000 }),
        cust({ client_customer_id: 'c2', name: 'Чистый', local_balance: 0 }),
      ]);
      render(
        <MemoryRouter>
          <CustomersPage />
        </MemoryRouter>,
      );
      await screen.findByText('Должник');
      fireEvent.click(screen.getByRole('button', { name: 'Есть долг' }));
      await waitFor(() => expect(screen.queryByText('Чистый')).not.toBeInTheDocument());
      expect(screen.getByText('Должник')).toBeInTheDocument();
    });
  });
  ```

- [ ] **Run it and see it FAIL:**
  ```
  npx vitest run src/pages/__tests__/CustomersPage.test.tsx
  ```
  Expected failure: `Failed to resolve import "../CustomersPage"`.

- [ ] **Create `sellary-cashier/src/pages/CustomersPage.tsx`:**
  ```tsx
  import { useCallback, useEffect, useMemo, useState } from 'react';
  import { useNavigate } from 'react-router-dom';
  import type { CustomerWithBalance } from '../lib/db';
  import { getCustomersWithLocalBalance } from '../lib/db';
  import { CustomerList } from '../components/customers/CustomerList';
  import { CustomerDetail } from '../components/customers/CustomerDetail';
  import { debtCounts, filterCustomers } from '../components/customers/customerFilter';
  import type { DebtFilter } from '../components/customers/customerFilter';

  export function CustomersPage() {
    const navigate = useNavigate();
    const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<DebtFilter>('all');
    const [search, setSearch] = useState('');
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    const reload = useCallback(async () => {
      const list = await getCustomersWithLocalBalance();
      setCustomers(list);
      setLoading(false);
    }, []);

    useEffect(() => {
      void reload();
    }, [reload]);

    const counts = useMemo(() => debtCounts(customers), [customers]);
    const visible = useMemo(() => filterCustomers(customers, filter, search), [customers, filter, search]);

    const selected = useMemo(
      () => visible.find((c) => c.client_customer_id === selectedClientId) ?? visible[0] ?? null,
      [visible, selectedClientId],
    );

    // Keep the selection valid when the visible list changes (filter/search/refetch).
    useEffect(() => {
      if (visible.length === 0) {
        setSelectedClientId(null);
        return;
      }
      if (!visible.some((c) => c.client_customer_id === selectedClientId)) {
        setSelectedClientId(visible[0].client_customer_id);
      }
    }, [visible, selectedClientId]);

    return (
      <div className="flex h-screen flex-col bg-gray-50 p-4 dark:bg-gray-900">
        <div className="mb-3 flex items-center gap-3">
          <button onClick={() => navigate('/cashier')} className="text-sm text-blue-600">
            ← Касса
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Клиенты</h1>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <CustomerList
            customers={visible}
            selectedClientId={selected?.client_customer_id ?? null}
            onSelect={(c) => setSelectedClientId(c.client_customer_id)}
            search={search}
            onSearch={setSearch}
            filter={filter}
            onFilter={setFilter}
            counts={counts}
            loading={loading}
          />
          <aside className="min-h-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:w-[420px]">
            {selected ? (
              <CustomerDetail customer={selected} onChanged={reload} />
            ) : (
              <div className="p-10 text-center text-sm text-gray-400">Выберите клиента</div>
            )}
          </aside>
        </div>
      </div>
    );
  }
  ```

- [ ] **Run it and see it PASS:**
  ```
  npx vitest run src/pages/__tests__/CustomersPage.test.tsx
  ```
  All three cases green.

- [ ] **Wire the route into `sellary-cashier/src/App.tsx` — additive only.** Add the import alongside the other page imports:
  ```tsx
  import { CustomersPage } from "./pages/CustomersPage";
  ```
  and add exactly one `<Route>` line inside `<Routes>`, immediately after the `/history` route (before the catch-all `<Route path="*" …>`):
  ```tsx
        <Route path="/customers" element={<CustomersPage />} />
  ```
  Do not otherwise change App.tsx. Resulting `<Routes>` block:
  ```tsx
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cashier" element={<CashierShell />} />
          <Route path="/pin-setup" element={<PinSetupPage />} />
          <Route path="/pin-unlock" element={<PinUnlockPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
  ```

- [ ] **Add the «Клиенты» nav link to `sellary-cashier/src/pages/POSPage.tsx`.** In the header button group, insert a «Клиенты» button immediately before the existing «История» button:
  ```tsx
            <button onClick={() => navigate('/customers')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Клиенты
            </button>
            <button onClick={() => navigate('/history')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              История
            </button>
  ```
  (`navigate` is already in scope in `POSPage` — no new import.)

- [ ] **Run the full customers suite + typecheck gate:**
  ```
  npx vitest run src/components/customers src/pages/__tests__/CustomersPage.test.tsx
  npx tsc --noEmit
  ```
  All green; `tsc` exits 0. (`tsc` requires the data-model DAOs to be merged — see Interface assumptions.)

- [ ] **Commit:**
  ```
  git add sellary-cashier/src/pages/CustomersPage.tsx \
          sellary-cashier/src/pages/__tests__/CustomersPage.test.tsx \
          sellary-cashier/src/App.tsx \
          sellary-cashier/src/pages/POSPage.tsx
  git commit -m "feat(cashier): offline Customers screen at /customers with POS nav link

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final verification (run before declaring done)

- [ ] **Full cashier test suite** (from `sellary-cashier/`):
  ```
  npx vitest run
  ```
  Every suite green, including the six new customers/page suites and the untouched Phase-1 suites.

- [ ] **Typecheck gate:**
  ```
  npx tsc --noEmit
  ```
  Exit 0.

- [ ] **Manual smoke (note, not automated):** with a Rust toolchain, `npm run tauri:dev`, sign in, open «Клиенты» from the POS header, confirm the debt tabs/search filter, accept a debt repayment on a customer with a positive local debt, and see the debt drop immediately (before any sync).

---

## Notes & scope boundaries

- **Owned by other plans, consumed here:** the customer DAOs + types (`db.ts`, data-model plan), the credit `PaymentModal` «В долг» tab and `insertCustomer`/quick-create (spec §5.1, POS-UI/credit plan), and the sync ordering + `SyncStatusBadge` retry (credit-sync plan). This plan renders the badge and reads derived balances; it does not create customers, sell on credit, or drive sync.
- **`insertCustomerPayment` is fire-and-record:** it only writes to the `customer_payments` outbox. Cap-to-balance against the *server* debt happens on sync (backend C5); locally we guard `amount <= local_balance` for UX, matching the web «amount <= balance» guard.
- **No optimistic mutation of `local_balance`:** after a payment we refetch `getCustomersWithLocalBalance`, which recomputes the derived debt (§2.4) including the new outbox payment. This keeps a single source of truth and avoids double-counting.
</content>
</invoke>
