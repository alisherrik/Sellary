# Sales History UI (Cashier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the offline "История продаж" screen for the Tauri cashier entirely on the local `sales` + `sale_items` model (spec §8), with sync-status tabs, SQL-aggregate KPIs/chart over the full filter, a drift-proof receipt detail slide-over with retry/reprint, and a SettingsPage needs-attention management list.

**Architecture:** A new `/history` route renders `HistoryPage`, composed of small presentational components (`SyncStatusTabs`, `FilterMenu`, `KpiCards`, `HourlyChart`, `SalesTable` + `SyncStatusBadge`/`PaymentChip`, `SaleDetailPanel`). All data reads go through Plan 2 (data-model) DAOs `getSalesHistory` / `getHistoryAggregates` / `getSaleWithItems` — KPIs and the hourly chart are **SQL aggregates over the whole active filter**, not derived from the loaded page. Retry/resend funnel into Plan 4 (sync-engine) `requestSync` / `useSyncStore`. The receipt renders from the structured `sale_items` snapshot columns, so it survives a later product delete/rename.

**Tech Stack:** React 19, react-router-dom 7, Zustand, Tailwind v4 (`@import "tailwindcss"`), Heroicons, `Intl.NumberFormat('ru-RU')` UZS, vitest + @testing-library/react (jsdom).

**Depends on (this plan is LAST in the merge chain — per the [plan INDEX](2026-07-10-cashier-local-first-INDEX.md) §2: `data-model → backend → offline-auth → sync-engine → pos-ui → history-ui`):**
- **data-model** plan (unified local `sales`/`sale_items` schema, `getSalesHistory`/`getHistoryAggregates`/`getSaleWithItems`/`getNeedsAttentionCount`/`acknowledgeSale` DAOs and `LocalSale`/`LocalSaleItem`/`SaleWithItems`/`HistoryFilter` types — INDEX §4.5, §4.3).
- **sync-engine** plan (`sync-engine.requestSync(reason, { force })`, `sync-store.useSyncStore` incl. `hasRepeatedFailures` — INDEX §4.2, §5).
- **pos-ui** plan (SOLE owner of `src/lib/format.ts`, the `@heroicons/react`/`@fontsource/inter`/`react-hot-toast` deps, the POS-header `История` nav link, and — jointly with offline-auth's `App.tsx` — the `/history` route — INDEX §3). **This plan CONSUMES all of these; it does NOT create `format.ts`, install those deps, edit `App.tsx`, or edit `POSPage.tsx`.**

---

## File Structure

Create:
- `sellary-cashier/src/components/history/SyncStatusBadge.tsx` — badge + `badgeMeta()` mapping sync_status/error_kind → label+classes.
- `sellary-cashier/src/components/history/PaymentChip.tsx` — case-insensitive payment-method chip (cash/card+cardType/mobile).
- `sellary-cashier/src/components/history/SyncStatusTabs.tsx` — 4 tabs (Все / Синхронизировано / Не синхронизировано / Требует внимания).
- `sellary-cashier/src/components/history/KpiCards.tsx` — Оборот / Чеков / Средний чек / Не синхронизировано cards.
- `sellary-cashier/src/components/history/HourlyChart.tsx` — 08:00–22:00 bar chart from a 24-length hour-indexed array.
- `sellary-cashier/src/components/history/FilterMenu.tsx` — popover: payment method + date-from/date-to.
- `sellary-cashier/src/components/history/SalesTable.tsx` — table (Чек/Время/Оплата/Сумма/Синхронизация) + "Показать ещё".
- `sellary-cashier/src/components/history/SaleDetailPanel.tsx` — slide-over receipt from structured snapshot + sync-state box + Повторить/Печать.
- `sellary-cashier/src/components/history/NeedsAttentionList.tsx` — SettingsPage management list (resend + acknowledge, no delete).
- `sellary-cashier/src/pages/HistoryPage.tsx` — composes the above; owns filter state + paging + fetches.
- Test files under `sellary-cashier/src/components/history/__tests__/` and `sellary-cashier/src/pages/__tests__/`.

Modify:
- `sellary-cashier/src/pages/SettingsPage.tsx` — **additively** append `<NeedsAttentionList />` below the sync-status section + a "История продаж" nav link (INDEX §3: SettingsPage is shared/append-only; never a full-file replace).

**Consume (owned by earlier plans — do NOT create/edit here):**
- `sellary-cashier/src/lib/format.ts` (`formatCurrency`) — owned by **pos-ui** (INDEX §3); import it, do not create a second copy.
- `sellary-cashier/src/App.tsx` `/history` route — already present in the canonical `App.tsx` (INDEX §3, owner: offline-auth). Do NOT edit.
- `sellary-cashier/src/pages/POSPage.tsx` header `История` → `/history` nav link — owned by **pos-ui** (INDEX §3). Do NOT edit.
- `@heroicons/react`, `@fontsource/inter`, `react-hot-toast` deps — installed once by **pos-ui** (INDEX §3). Assume present.

**Interface assumptions (from dependency plans — do not redefine here):**
```ts
// from ../lib/db  (Plan 2 data-model) — CANONICAL shape from INDEX §4.5. Use this name & these fields verbatim.
export type SyncFilter = 'all' | 'synced' | 'unsynced' | 'attention'; // NOTE: 'attention', NOT 'needs_attention' (INDEX §4.5)
export type HistoryFilter = {
  search?: string;
  paymentMethod?: string;                  // falsy OR 'all' ⇒ NO filter — send undefined/omitted for the «Все» tab, never the literal 'all'
  syncFilter?: SyncFilter;                  // 'all' | 'synced' | 'unsynced' | 'attention'
  dateFrom?: string;                        // 'YYYY-MM-DD' — NOT startDate
  dateTo?: string;                          // 'YYYY-MM-DD' — NOT endDate
  limit: number;                            // required (INDEX §4.5)
  offset: number;                           // required (INDEX §4.5)
};
export interface LocalSale {
  id: number; client_sale_id: string; idempotency_key: string; receipt_no: number;
  server_sale_id: number | null;
  subtotal: number; discount_amount: number; tax_amount: number; total_amount: number;
  paid_amount: number; change_amount: number;
  payment_method: string; card_type: string | null; notes: string | null;
  cashier_user_id: number | null; cashier_username: string | null;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  error_kind: string | null; next_attempt_at: string | null; first_failed_at: string | null;
  last_error: string | null; retry_count: number; stock_applied: number;
  created_at_client: string; synced_at: string | null; updated_at: string;
}
export interface LocalSaleItem {
  id: number; sale_id: number; product_id: number; product_name: string; barcode: string | null;
  uom: string; quantity: number; unit_price: number; tax_percent: number;
  line_subtotal: number; line_total: number; sort_order: number;
  product_unit_id: number | null; sold_unit_label: string | null; sold_unit_factor: number | null; sold_quantity: number | null;
}
export interface SaleWithItems extends LocalSale { items: LocalSaleItem[]; }
export function getSalesHistory(opts: HistoryFilter): Promise<LocalSale[]>;
export function getHistoryAggregates(opts: HistoryFilter): Promise<{ turnover: number; count: number; unsynced: number; hourly: number[] }>; // hourly is 24-length, hour-indexed
export function getSaleWithItems(saleId: number): Promise<SaleWithItems | null>;
export function getNeedsAttentionCount(): Promise<number>;
export function acknowledgeSale(saleId: number): Promise<void>; // INDEX §4.3 — resolves the "Отметить решённым" action

// from ../lib/sync-engine  (Plan 4 sync-engine) — INDEX §4.2
export function requestSync(reason: SyncReason, opts?: { force?: boolean }): Promise<unknown>; // SyncReason union includes 'manual'; force:true resends permanent-failed sales

// from ../lib/sync-store  (Plan 4 sync-engine) — INDEX §5 adds hasRepeatedFailures
export function useSyncStore(): {
  online: boolean; unsyncedCount: number; needsAttentionCount: number;
  lastSyncedAt: string | null; isSyncing: boolean; syncNow: () => Promise<unknown> | void;
  hasRepeatedFailures: boolean; // retry_count ≥ 8 (spec §4.7) — drives the non-blocking "повторные сбои" chip
};
```

---

### Task 0: Verify Heroicons is present (do NOT install)

Per INDEX §3, **pos-ui** is the sole installer of `@heroicons/react` (plus `@fontsource/inter`, `react-hot-toast`). Because this plan merges AFTER pos-ui, the dep already exists. Do NOT run `npm install` here — that would fight the pos-ui lockfile entry.

**Files:** none (verification only).

Steps:
- [ ] From `sellary-cashier/`, confirm it resolves: `node -e "require.resolve('@heroicons/react/24/outline/XMarkIcon')"` prints a path.
- [ ] If it does NOT resolve, STOP — the pos-ui plan has not merged yet; the merge order (INDEX §2) has been violated. Do not self-install; get pos-ui merged first.

---

### Task 1: Consume `formatCurrency` (do NOT create it)

Per INDEX §3, `src/lib/format.ts` is **owned by the pos-ui plan** (identical signature). Because this plan merges AFTER pos-ui, the module already exists — **do NOT create a second `format.ts`**. Every component below imports it with `import { formatCurrency } from '../../lib/format';` (or `'../lib/format'` from `pages/`).

**Files:** none (consumption only).

For reference, the pos-ui-owned module has this exact shape (do not re-author it here):
```ts
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Format a base-UZS money amount for display, e.g. formatCurrency(1234567) -> "1 234 567 UZS". */
export function formatCurrency(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${nf.format(Math.round(safe))} UZS`;
}
```

Steps:
- [ ] From `sellary-cashier/`, confirm the pos-ui-owned module resolves: `node -e "require.resolve('./src/lib/format.ts')"` (or check the file exists). If it does NOT exist, STOP — pos-ui has not merged; the merge order (INDEX §2) is violated. Do not create it yourself.

---

### Task 2: `SyncStatusBadge`

Maps a sale's `sync_status` + `error_kind` to a coloured pill. Exported `badgeMeta()` is pure and unit-tested.

**Files:**
- Create: `sellary-cashier/src/components/history/SyncStatusBadge.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/SyncStatusBadge.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/SyncStatusBadge.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusBadge, badgeMeta } from '../SyncStatusBadge';

describe('badgeMeta', () => {
  it('maps each state to the right label', () => {
    expect(badgeMeta('synced', null).label).toBe('Синхронизировано');
    expect(badgeMeta('failed', 'permanent').label).toBe('Требует внимания');
    expect(badgeMeta('failed', 'transient').label).toBe('Повтор');
    expect(badgeMeta('syncing', null).label).toBe('Синхронизация…');
    expect(badgeMeta('pending', null).label).toBe('Ожидает');
  });
  it('uses red styling only for permanent failures', () => {
    expect(badgeMeta('failed', 'permanent').cls).toContain('red');
    expect(badgeMeta('failed', 'transient').cls).not.toContain('red');
  });
});

describe('SyncStatusBadge', () => {
  it('renders the mapped label', () => {
    render(<SyncStatusBadge syncStatus="synced" errorKind={null} />);
    expect(screen.getByText('Синхронизировано')).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/SyncStatusBadge.test.tsx`
      Expected failure: `Failed to resolve import "../SyncStatusBadge"`.
- [ ] Create `sellary-cashier/src/components/history/SyncStatusBadge.tsx`:
```tsx
export interface BadgeMeta {
  label: string;
  cls: string;
}

/** Pure mapping of the local sale sync state to a label + Tailwind classes. */
export function badgeMeta(syncStatus: string, errorKind?: string | null): BadgeMeta {
  if (syncStatus === 'synced') {
    return { label: 'Синхронизировано', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' };
  }
  if (syncStatus === 'failed' && errorKind === 'permanent') {
    return { label: 'Требует внимания', cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300' };
  }
  if (syncStatus === 'failed') {
    return { label: 'Повтор', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' };
  }
  if (syncStatus === 'syncing') {
    return { label: 'Синхронизация…', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' };
  }
  return { label: 'Ожидает', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
}

export function SyncStatusBadge({ syncStatus, errorKind }: { syncStatus: string; errorKind?: string | null }) {
  const meta = badgeMeta(syncStatus, errorKind);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/SyncStatusBadge.test.tsx`
- [ ] Commit:
  - `git add src/components/history/SyncStatusBadge.tsx src/components/history/__tests__/SyncStatusBadge.test.tsx`
  - `git commit -m "feat(cashier): add SyncStatusBadge for history rows"`

---

### Task 3: `PaymentChip`

Case-insensitive payment chip reused by the table and the detail panel.

**Files:**
- Create: `sellary-cashier/src/components/history/PaymentChip.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/PaymentChip.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/PaymentChip.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentChip } from '../PaymentChip';

describe('PaymentChip', () => {
  it('renders cash by default and is case-insensitive', () => {
    render(<PaymentChip method="CASH" />);
    expect(screen.getByText(/Наличные/)).toBeInTheDocument();
  });
  it('renders the card brand label from card_type', () => {
    render(<PaymentChip method="card" cardType="ALIF" />);
    expect(screen.getByText(/Alif/)).toBeInTheDocument();
  });
  it('renders mobile', () => {
    render(<PaymentChip method="mobile" />);
    expect(screen.getByText(/Мобильный/)).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/PaymentChip.test.tsx`
      Expected failure: `Failed to resolve import "../PaymentChip"`.
- [ ] Create `sellary-cashier/src/components/history/PaymentChip.tsx`:
```tsx
const cardLabels: Record<string, string> = { alif: 'Alif', eskhata: 'Eskhata', dc: 'DC' };

export function PaymentChip({ method, cardType }: { method: string; cardType?: string | null }) {
  const m = (method || '').toLowerCase();
  const ct = (cardType || '').toLowerCase();
  let label = '💵 Наличные';
  let cls = 'bg-zinc-100 text-zinc-600 dark:bg-gray-700 dark:text-gray-300';
  if (m === 'card') {
    label = `💳 ${ct ? (cardLabels[ct] ?? cardType) : 'Карта'}`;
    cls = 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300';
  } else if (m === 'mobile') {
    label = '📱 Мобильный';
    cls = 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300';
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/PaymentChip.test.tsx`
- [ ] Commit:
  - `git add src/components/history/PaymentChip.tsx src/components/history/__tests__/PaymentChip.test.tsx`
  - `git commit -m "feat(cashier): add case-insensitive PaymentChip"`

---

### Task 4: `SyncStatusTabs`

Four tabs that replace the web's completed/returns/cancelled. The `attention` tab (INDEX §4.5 canonical `syncFilter` value) shows a count badge.

**Files:**
- Create: `sellary-cashier/src/components/history/SyncStatusTabs.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/SyncStatusTabs.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/SyncStatusTabs.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusTabs } from '../SyncStatusTabs';

describe('SyncStatusTabs', () => {
  it('renders all four tabs', () => {
    render(<SyncStatusTabs value="all" onChange={() => {}} />);
    ['Все', 'Синхронизировано', 'Не синхронизировано', 'Требует внимания'].forEach((t) =>
      expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument(),
    );
  });
  it('fires onChange with the tab key', () => {
    const onChange = vi.fn();
    render(<SyncStatusTabs value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Не синхронизировано/ }));
    expect(onChange).toHaveBeenCalledWith('unsynced');
  });
  it('shows the needs-attention count badge when > 0', () => {
    render(<SyncStatusTabs value="all" onChange={() => {}} needsAttentionCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/SyncStatusTabs.test.tsx`
      Expected failure: `Failed to resolve import "../SyncStatusTabs"`.
- [ ] Create `sellary-cashier/src/components/history/SyncStatusTabs.tsx`:
```tsx
// Matches the canonical HistoryFilter['syncFilter'] union from INDEX §4.5 ('attention', NOT 'needs_attention').
export type SyncFilter = 'all' | 'synced' | 'unsynced' | 'attention';

const TABS: { key: SyncFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'synced', label: 'Синхронизировано' },
  { key: 'unsynced', label: 'Не синхронизировано' },
  { key: 'attention', label: 'Требует внимания' },
];

export function SyncStatusTabs({
  value,
  onChange,
  needsAttentionCount = 0,
}: {
  value: SyncFilter;
  onChange: (value: SyncFilter) => void;
  needsAttentionCount?: number;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
            value === tab.key
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          {tab.label}
          {tab.key === 'attention' && needsAttentionCount > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
              {needsAttentionCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/SyncStatusTabs.test.tsx`
- [ ] Commit:
  - `git add src/components/history/SyncStatusTabs.tsx src/components/history/__tests__/SyncStatusTabs.test.tsx`
  - `git commit -m "feat(cashier): add SyncStatusTabs for history filtering"`

---

### Task 5: `KpiCards`

Оборот / Чеков / Средний чек (verbatim web) + a cashier-unique "Не синхронизировано" card (amber if > 0, clickable → filters to that tab). All values come from props (the `getHistoryAggregates` result), never from the loaded page.

**Files:**
- Create: `sellary-cashier/src/components/history/KpiCards.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/KpiCards.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/KpiCards.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiCards } from '../KpiCards';

describe('KpiCards', () => {
  it('renders turnover, count, average and unsynced from props', () => {
    render(<KpiCards turnover={1000000} count={40} unsynced={3} onUnsyncedClick={() => {}} />);
    expect(screen.getByText('40')).toBeInTheDocument();          // Чеков
    expect(screen.getByText('3')).toBeInTheDocument();           // Не синхронизировано
    // average = 1000000 / 40 = 25000
    expect(screen.getByText((t) => t.replace(/\s/g, '') === '25000UZS')).toBeInTheDocument();
  });
  it('computes average = 0 when count is 0', () => {
    render(<KpiCards turnover={0} count={0} unsynced={0} onUnsyncedClick={() => {}} />);
    expect(screen.getAllByText((t) => t.replace(/\s/g, '') === '0UZS').length).toBeGreaterThan(0);
  });
  it('unsynced card is clickable', () => {
    const onClick = vi.fn();
    render(<KpiCards turnover={100} count={1} unsynced={2} onUnsyncedClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Не синхронизировано/ }));
    expect(onClick).toHaveBeenCalled();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/KpiCards.test.tsx`
      Expected failure: `Failed to resolve import "../KpiCards"`.
- [ ] Create `sellary-cashier/src/components/history/KpiCards.tsx`:
```tsx
import { formatCurrency } from '../../lib/format';

export function KpiCards({
  turnover,
  count,
  unsynced,
  onUnsyncedClick,
}: {
  turnover: number;
  count: number;
  unsynced: number;
  onUnsyncedClick: () => void;
}) {
  const avg = count > 0 ? turnover / count : 0;
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">Оборот</p>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{formatCurrency(turnover)}</p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">Чеков</p>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{count}</p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">Средний чек</p>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{formatCurrency(avg)}</p>
      </div>
      <button
        type="button"
        onClick={onUnsyncedClick}
        className={`rounded-2xl p-4 text-left shadow-sm transition-colors ${
          unsynced > 0
            ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'
            : 'border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800'
        }`}
      >
        <p className={`text-xs ${unsynced > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
          Не синхронизировано
        </p>
        <p className={`text-xl font-bold tabular-nums sm:text-2xl ${unsynced > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>
          {unsynced}
        </p>
      </button>
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/KpiCards.test.tsx`
- [ ] Commit:
  - `git add src/components/history/KpiCards.tsx src/components/history/__tests__/KpiCards.test.tsx`
  - `git commit -m "feat(cashier): add history KPI cards incl. unsynced"`

---

### Task 6: `HourlyChart`

08:00–22:00 bars from a 24-length hour-indexed array (matches `new Date(created_at_client).getHours()` bucketing produced by `getHistoryAggregates`).

**Files:**
- Create: `sellary-cashier/src/components/history/HourlyChart.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/HourlyChart.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/HourlyChart.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HourlyChart } from '../HourlyChart';

function hours(): number[] {
  const a = Array.from({ length: 24 }, () => 0);
  a[9] = 500;   // inside window
  a[14] = 1000; // inside window
  a[3] = 999;   // OUTSIDE window, must be ignored
  return a;
}

describe('HourlyChart', () => {
  it('renders 15 hour labels 8..22 and hides the outside-window value', () => {
    render(<HourlyChart hourly={hours()} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument(); // hour 3 not rendered
  });
  it('renders nothing when all buckets in-window are zero', () => {
    const { container } = render(<HourlyChart hourly={Array.from({ length: 24 }, () => 0)} />);
    expect(container.firstChild).toBeNull();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/HourlyChart.test.tsx`
      Expected failure: `Failed to resolve import "../HourlyChart"`.
- [ ] Create `sellary-cashier/src/components/history/HourlyChart.tsx`:
```tsx
import { formatCurrency } from '../../lib/format';

const START = 8;
const END = 22;

export function HourlyChart({ hourly }: { hourly: number[] }) {
  const slice = Array.from({ length: END - START + 1 }, (_, i) => ({
    hour: START + i,
    value: Number(hourly?.[START + i] ?? 0),
  }));
  const total = slice.reduce((sum, b) => sum + b.value, 0);
  if (total <= 0) return null;
  const max = Math.max(1, ...slice.map((b) => b.value));

  return (
    <div className="mb-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Оборот по часам</p>
        <span className="text-[11px] text-gray-400">08:00 – 22:00</span>
      </div>
      <div className="flex h-20 items-end gap-1">
        {slice.map((b) => (
          <div key={b.hour} className="flex flex-1 flex-col items-center gap-1" title={`${b.hour}:00 — ${formatCurrency(b.value)}`}>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-blue-500/80 transition-all hover:bg-blue-600"
                style={{ height: `${Math.max(b.value > 0 ? 6 : 0, (b.value / max) * 100)}%` }}
              />
            </div>
            <span className="text-[9px] tabular-nums text-gray-400">{b.hour}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/HourlyChart.test.tsx`
- [ ] Commit:
  - `git add src/components/history/HourlyChart.tsx src/components/history/__tests__/HourlyChart.test.tsx`
  - `git commit -m "feat(cashier): add hourly turnover chart 08-22"`

---

### Task 7: `FilterMenu`

Cashier-local popover (the web `FilterMenu` is Next/portal-coupled — do not import it). Payment-method select + date-from/date-to, controlled by the parent.

> This is a purely presentational, plan-owned component; its `startDate`/`endDate` props are local UI state. `HistoryPage` (Task 10) maps them onto the canonical `HistoryFilter.dateFrom`/`dateTo` fields (INDEX §4.5) at the query boundary — the DAOs never see `startDate`/`endDate`.

**Files:**
- Create: `sellary-cashier/src/components/history/FilterMenu.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/FilterMenu.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/FilterMenu.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterMenu } from '../FilterMenu';

describe('FilterMenu', () => {
  it('shows the active-filter count and opens the panel', () => {
    render(
      <FilterMenu
        paymentMethod="card"
        startDate=""
        endDate=""
        onPaymentMethodChange={() => {}}
        onStartDateChange={() => {}}
        onEndDateChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText('1')).toBeInTheDocument(); // one active filter (payment)
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    expect(screen.getByLabelText('Способ оплаты')).toBeInTheDocument();
  });
  it('emits payment-method changes', () => {
    const onPaymentMethodChange = vi.fn();
    render(
      <FilterMenu
        paymentMethod="all"
        startDate=""
        endDate=""
        onPaymentMethodChange={onPaymentMethodChange}
        onStartDateChange={() => {}}
        onEndDateChange={() => {}}
        onReset={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    fireEvent.change(screen.getByLabelText('Способ оплаты'), { target: { value: 'mobile' } });
    expect(onPaymentMethodChange).toHaveBeenCalledWith('mobile');
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/FilterMenu.test.tsx`
      Expected failure: `Failed to resolve import "../FilterMenu"`.
- [ ] Create `sellary-cashier/src/components/history/FilterMenu.tsx`:
```tsx
import { useState } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';

export type PaymentFilter = 'all' | 'cash' | 'card' | 'mobile';

const PAYMENT_OPTIONS: { value: PaymentFilter; label: string }[] = [
  { value: 'all', label: 'Все оплаты' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'mobile', label: 'Мобильный' },
];

export function FilterMenu({
  paymentMethod,
  startDate,
  endDate,
  onPaymentMethodChange,
  onStartDateChange,
  onEndDateChange,
  onReset,
}: {
  paymentMethod: PaymentFilter;
  startDate: string;
  endDate: string;
  onPaymentMethodChange: (value: PaymentFilter) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = (paymentMethod !== 'all' ? 1 : 0) + (startDate ? 1 : 0) + (endDate ? 1 : 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        <FunnelIcon className="h-4 w-4" />
        <span>Фильтры</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{activeCount}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Способ оплаты</span>
              <select
                aria-label="Способ оплаты"
                value={paymentMethod}
                onChange={(e) => onPaymentMethodChange(e.target.value as PaymentFilter)}
                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              >
                {PAYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Дата от</span>
                <input
                  type="date"
                  aria-label="Дата от"
                  value={startDate}
                  onChange={(e) => onStartDateChange(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Дата до</span>
                <input
                  type="date"
                  aria-label="Дата до"
                  value={endDate}
                  onChange={(e) => onEndDateChange(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/FilterMenu.test.tsx`
- [ ] Commit:
  - `git add src/components/history/FilterMenu.tsx src/components/history/__tests__/FilterMenu.test.tsx`
  - `git commit -m "feat(cashier): add history FilterMenu popover"`

---

### Task 8: `SalesTable`

Table columns `Чек · Время · Оплата · Сумма · Синхронизация`, row-click, and `Показать ещё` load-more.

**Files:**
- Create: `sellary-cashier/src/components/history/SalesTable.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/SalesTable.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/SalesTable.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalesTable } from '../SalesTable';
import type { LocalSale } from '../../../lib/db';

function sale(over: Partial<LocalSale> = {}): LocalSale {
  return {
    id: 1, client_sale_id: 'abcdef123456', idempotency_key: 'i', receipt_no: 42,
    server_sale_id: null, subtotal: 100, discount_amount: 0, tax_amount: 0, total_amount: 100,
    paid_amount: 100, change_amount: 0, payment_method: 'cash', card_type: null, notes: null,
    cashier_user_id: null, cashier_username: null, sync_status: 'pending', error_kind: null,
    next_attempt_at: null, first_failed_at: null, last_error: null, retry_count: 0, stock_applied: 1,
    created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null, updated_at: '2026-07-10T09:00:00.000Z',
    ...over,
  };
}

describe('SalesTable', () => {
  it('renders a row with receipt number and sync badge', () => {
    render(<SalesTable sales={[sale()]} selectedId={null} onRowClick={() => {}} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Ожидает')).toBeInTheDocument();
  });
  it('fires onRowClick with the sale', () => {
    const onRowClick = vi.fn();
    render(<SalesTable sales={[sale()]} selectedId={null} onRowClick={onRowClick} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    fireEvent.click(screen.getByText('#42'));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
  it('shows load-more only when hasMore', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<SalesTable sales={[sale()]} selectedId={null} onRowClick={() => {}} hasMore onLoadMore={onLoadMore} loadingMore={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Показать ещё/ }));
    expect(onLoadMore).toHaveBeenCalled();
    rerender(<SalesTable sales={[sale()]} selectedId={null} onRowClick={() => {}} hasMore={false} onLoadMore={onLoadMore} loadingMore={false} />);
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
  });
  it('renders an empty state', () => {
    render(<SalesTable sales={[]} selectedId={null} onRowClick={() => {}} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.getByText('Продажи не найдены')).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/SalesTable.test.tsx`
      Expected failure: `Failed to resolve import "../SalesTable"`.
- [ ] Create `sellary-cashier/src/components/history/SalesTable.tsx`:
```tsx
import type { LocalSale } from '../../lib/db';
import { formatCurrency } from '../../lib/format';
import { SyncStatusBadge } from './SyncStatusBadge';
import { PaymentChip } from './PaymentChip';

export function SalesTable({
  sales,
  selectedId,
  onRowClick,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  sales: LocalSale[];
  selectedId: number | null;
  onRowClick: (sale: LocalSale) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (sales.length === 0) {
    return <div className="p-12 text-center text-gray-500">Продажи не найдены</div>;
  }
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-400 dark:border-gray-700">
            <th className="px-4 py-3 text-left font-medium">Чек</th>
            <th className="px-4 py-3 text-left font-medium">Время</th>
            <th className="px-4 py-3 text-left font-medium">Оплата</th>
            <th className="px-4 py-3 text-right font-medium">Сумма</th>
            <th className="px-4 py-3 text-left font-medium">Синхронизация</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => {
            const active = selectedId === sale.id;
            return (
              <tr
                key={sale.id}
                onClick={() => onRowClick(sale)}
                className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 dark:border-gray-700/50 dark:hover:bg-gray-700/40 ${
                  active ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''
                }`}
              >
                <td className="px-4 py-3 font-mono font-semibold text-gray-900 dark:text-white">
                  #{sale.receipt_no}
                  <span className="ml-2 text-[10px] font-normal text-gray-400">{sale.client_sale_id.slice(0, 8)}</span>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-gray-400">
                  {new Date(sale.created_at_client).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 py-3">
                  <PaymentChip method={sale.payment_method} cardType={sale.card_type} />
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(sale.total_amount)}
                </td>
                <td className="px-4 py-3">
                  <SyncStatusBadge syncStatus={sale.sync_status} errorKind={sale.error_kind} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="flex justify-center border-t border-gray-50 p-4 dark:border-gray-700/50">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {loadingMore ? 'Загрузка…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/SalesTable.test.tsx`
- [ ] Commit:
  - `git add src/components/history/SalesTable.tsx src/components/history/__tests__/SalesTable.test.tsx`
  - `git commit -m "feat(cashier): add history SalesTable with sync column + load-more"`

---

### Task 9: `SaleDetailPanel` (drift-proof receipt + retry + reprint)

Slide-over that fetches `getSaleWithItems(saleId)` and renders the receipt from the **structured snapshot** (`product_name`, `uom`, `unit_price`, `line_total`, cashier, totals) — so it renders correctly even after the product is deleted server-side (spec §8.2/§8.3, cashier test 9). A sync-state box shows synced/waiting/error; a red permanent-error box carries `last_error` + "Повторить" (→ `requestSync('manual', { force: true })`). "Печать чека" reprints via `window.print`. A muted note replaces returns/void.

**Files:**
- Create: `sellary-cashier/src/components/history/SaleDetailPanel.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/SaleDetailPanel.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/SaleDetailPanel.test.tsx` (this is cashier test 9 — "receipt renders from structured snapshot after a product delete"):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGetSaleWithItems, mockGetProductById, mockRequestSync } = vi.hoisted(() => ({
  mockGetSaleWithItems: vi.fn(),
  mockGetProductById: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getSaleWithItems: mockGetSaleWithItems,
  getProductById: mockGetProductById,
}));
vi.mock('../../../lib/sync-engine', () => ({ requestSync: mockRequestSync }));

import { SaleDetailPanel } from '../SaleDetailPanel';

function saleWithDeletedProduct(over = {}) {
  return {
    id: 1, client_sale_id: 'abcdef123456', idempotency_key: 'i', receipt_no: 42,
    server_sale_id: null, subtotal: 100, discount_amount: 0, tax_amount: 0, total_amount: 100,
    paid_amount: 120, change_amount: 20, payment_method: 'cash', card_type: null, notes: null,
    cashier_user_id: 7, cashier_username: 'kassir', sync_status: 'failed', error_kind: 'permanent',
    next_attempt_at: null, first_failed_at: null, last_error: 'Products not found', retry_count: 3,
    stock_applied: 1, created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null,
    updated_at: '2026-07-10T09:00:00.000Z',
    items: [{
      id: 10, sale_id: 1, product_id: 999, product_name: 'Удалённый товар', barcode: '111',
      uom: 'шт', quantity: 2, unit_price: 50, tax_percent: 0, line_subtotal: 100, line_total: 100,
      sort_order: 0, product_unit_id: null, sold_unit_label: null, sold_unit_factor: null, sold_quantity: null,
    }],
    ...over,
  };
}

describe('SaleDetailPanel', () => {
  it('renders the receipt from the snapshot even though the product was deleted', async () => {
    mockGetSaleWithItems.mockResolvedValue(saleWithDeletedProduct());
    mockGetProductById.mockResolvedValue(null); // product gone from catalog
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    // product name comes from the sale_items snapshot, not the products table
    expect(await screen.findByText('Удалённый товар')).toBeInTheDocument();
    expect(screen.getByText('Чек #42')).toBeInTheDocument();
    expect(mockGetProductById).not.toHaveBeenCalled(); // never touches live catalog
  });

  it('surfaces a permanent error box with last_error and retries via requestSync', async () => {
    mockGetSaleWithItems.mockResolvedValue(saleWithDeletedProduct());
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    expect(await screen.findByText('Products not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    await waitFor(() => expect(mockRequestSync).toHaveBeenCalledWith('manual', { force: true }));
  });

  it('reprints via window.print and shows the no-returns note', async () => {
    mockGetSaleWithItems.mockResolvedValue(saleWithDeletedProduct({ sync_status: 'synced', error_kind: null, server_sale_id: 555, synced_at: '2026-07-10T10:00:00.000Z' }));
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    await screen.findByText('Чек #42');
    fireEvent.click(screen.getByRole('button', { name: /Печать чека/ }));
    expect(printSpy).toHaveBeenCalled();
    expect(screen.getByText(/Возвраты и долги доступны в веб-версии/)).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/SaleDetailPanel.test.tsx`
      Expected failure: `Failed to resolve import "../SaleDetailPanel"`.
- [ ] Create `sellary-cashier/src/components/history/SaleDetailPanel.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { XMarkIcon, PrinterIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { getSaleWithItems } from '../../lib/db';
import type { SaleWithItems } from '../../lib/db';
import { requestSync } from '../../lib/sync-engine';
import { formatCurrency } from '../../lib/format';
import { SyncStatusBadge } from './SyncStatusBadge';
import { PaymentChip } from './PaymentChip';

export function SaleDetailPanel({ saleId, onClose }: { saleId: number | null; onClose: () => void }) {
  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (saleId == null) {
      setSale(null);
      return;
    }
    setSale(null);
    getSaleWithItems(saleId).then((row) => {
      if (!cancelled) setSale(row);
    });
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  if (saleId == null) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await requestSync('manual', { force: true });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
        <div>
          <h2 className="font-mono text-[17px] font-bold text-gray-900 dark:text-white">Чек #{sale?.receipt_no ?? ''}</h2>
          <p className="text-[12px] text-gray-400">
            {sale ? new Date(sale.created_at_client).toLocaleString('ru-RU') : ''}
            {sale?.cashier_username ? ` · ${sale.cashier_username}` : ''}
          </p>
        </div>
        {sale && <span className="ml-auto"><SyncStatusBadge syncStatus={sale.sync_status} errorKind={sale.error_kind} /></span>}
        <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      {!sale ? (
        <div className="p-8 text-center text-sm text-gray-400">Загрузка…</div>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Items from the structured snapshot */}
          <div>
            <p className="mb-2 text-[13px] font-semibold text-gray-900 dark:text-white">Товары · {sale.items.length}</p>
            <div className="space-y-2">
              {sale.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-gray-800 dark:text-gray-100">{item.product_name}</p>
                    <p className="text-[11px] text-gray-400">
                      {item.quantity} {item.uom} × {formatCurrency(item.unit_price)}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(item.line_total)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700">
            <div className="flex justify-between text-[13px] text-gray-500"><span>Подытог</span><span className="tabular-nums">{formatCurrency(sale.subtotal)}</span></div>
            <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Скидка</span><span className="tabular-nums">{formatCurrency(sale.discount_amount)}</span></div>
            <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Налог</span><span className="tabular-nums">{formatCurrency(sale.tax_amount)}</span></div>
            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-[13px] font-semibold text-gray-900 dark:border-gray-700 dark:text-white"><span>Итого</span><span className="tabular-nums">{formatCurrency(sale.total_amount)}</span></div>
            <div className="mt-2 flex items-center justify-between text-[13px] text-gray-500"><span>Оплата</span><PaymentChip method={sale.payment_method} cardType={sale.card_type} /></div>
            {sale.payment_method === 'cash' && (
              <>
                <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Получено</span><span className="tabular-nums">{formatCurrency(sale.paid_amount)}</span></div>
                <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Сдача</span><span className="tabular-nums">{formatCurrency(sale.change_amount)}</span></div>
              </>
            )}
          </div>

          {/* Sync-state box */}
          {sale.sync_status === 'synced' ? (
            <div className="rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              Синхронизировано{sale.server_sale_id != null ? ` · сервер #${sale.server_sale_id}` : ''}
              {sale.synced_at ? ` · ${new Date(sale.synced_at).toLocaleString('ru-RU')}` : ''}
            </div>
          ) : sale.sync_status === 'failed' && sale.error_kind === 'permanent' ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20">
              <p className="text-[13px] font-semibold text-red-700 dark:text-red-300">Ошибка синхронизации</p>
              {sale.last_error && <p className="mt-1 text-[12px] text-red-700/90 dark:text-red-300/90">{sale.last_error}</p>}
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Повторить
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Ожидает синхронизации
            </div>
          )}

          <p className="text-[12px] italic text-gray-400">Возвраты и долги доступны в веб-версии (нужен интернет).</p>
        </div>
      )}

      {sale && (
        <div className="mt-auto border-t border-gray-100 p-4 dark:border-gray-700">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <PrinterIcon className="h-4 w-4" />
            Печать чека
          </button>
        </div>
      )}
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/SaleDetailPanel.test.tsx`
- [ ] Commit:
  - `git add src/components/history/SaleDetailPanel.tsx src/components/history/__tests__/SaleDetailPanel.test.tsx`
  - `git commit -m "feat(cashier): add drift-proof SaleDetailPanel with retry + reprint"`

---

### Task 10: `HistoryPage` (compose + aggregates-over-filter)

Owns filter state (tab, payment, dates, debounced search), paging, and fetches. KPIs and the hourly chart come from `getHistoryAggregates` over the **whole active filter**; the table is a paged `getSalesHistory`. This is the second half of cashier test 9 — "aggregates over the full filter (not just the page)".

**Files:**
- Create: `sellary-cashier/src/pages/HistoryPage.tsx`
- Test: `sellary-cashier/src/pages/__tests__/HistoryPage.test.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/HistoryPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGetSalesHistory, mockGetHistoryAggregates, mockGetSaleWithItems, mockUseSyncStore, mockRequestSync } = vi.hoisted(() => ({
  mockGetSalesHistory: vi.fn(),
  mockGetHistoryAggregates: vi.fn(),
  mockGetSaleWithItems: vi.fn(),
  mockUseSyncStore: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../lib/db', () => ({
  getSalesHistory: mockGetSalesHistory,
  getHistoryAggregates: mockGetHistoryAggregates,
  getSaleWithItems: mockGetSaleWithItems,
  getProductById: vi.fn(),
}));
vi.mock('../../lib/sync-store', () => ({ useSyncStore: mockUseSyncStore }));
vi.mock('../../lib/sync-engine', () => ({ requestSync: mockRequestSync }));

import { HistoryPage } from '../HistoryPage';

function oneSmallSale() {
  return [{
    id: 1, client_sale_id: 'abcdef123456', idempotency_key: 'i', receipt_no: 7,
    server_sale_id: null, subtotal: 300, discount_amount: 0, tax_amount: 0, total_amount: 300,
    paid_amount: 300, change_amount: 0, payment_method: 'cash', card_type: null, notes: null,
    cashier_user_id: null, cashier_username: null, sync_status: 'synced', error_kind: null,
    next_attempt_at: null, first_failed_at: null, last_error: null, retry_count: 0, stock_applied: 1,
    created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null, updated_at: '2026-07-10T09:00:00.000Z',
  }];
}

beforeEach(() => {
  mockUseSyncStore.mockReturnValue({
    online: true, unsyncedCount: 0, needsAttentionCount: 0, lastSyncedAt: null, isSyncing: false, syncNow: vi.fn(),
    hasRepeatedFailures: false,
  });
});

describe('HistoryPage', () => {
  it('shows KPIs from getHistoryAggregates, NOT from summing the loaded page', async () => {
    mockGetSalesHistory.mockResolvedValue(oneSmallSale());          // page sums to 300
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 1000000, count: 42, unsynced: 3, hourly: Array.from({ length: 24 }, () => 0) });

    render(<MemoryRouter><HistoryPage /></MemoryRouter>);

    // turnover from aggregates (1 000 000), not the page total (300)
    await waitFor(() => expect(screen.getByText((t) => t.replace(/\s/g, '') === '1000000UZS')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();  // Чеков from aggregates
    expect(screen.getByText('3')).toBeInTheDocument();   // Не синхронизировано from aggregates
    expect(screen.queryByText((t) => t.replace(/\s/g, '') === '300UZS' && t !== undefined)).toBeTruthy(); // row still shows its own total
  });

  it('calls both DAOs with the same active filter opts', async () => {
    mockGetSalesHistory.mockResolvedValue([]);
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) });
    render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    await waitFor(() => expect(mockGetHistoryAggregates).toHaveBeenCalled());
    const histOpts = mockGetSalesHistory.mock.calls[0][0];
    const aggOpts = mockGetHistoryAggregates.mock.calls[0][0];
    expect(aggOpts.syncFilter).toBe(histOpts.syncFilter);
    expect(aggOpts.syncFilter).toBe('all');
  });

  it('omits paymentMethod on the «Все» tab (never sends the literal "all") and maps dates to dateFrom/dateTo', async () => {
    mockGetSalesHistory.mockResolvedValue([]);
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) });
    render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    await waitFor(() => expect(mockGetSalesHistory).toHaveBeenCalled());
    const opts = mockGetSalesHistory.mock.calls[0][0];
    expect(opts.paymentMethod).toBeUndefined();      // NOT 'all'
    expect(opts).not.toHaveProperty('startDate');    // canonical field is dateFrom
    expect(opts).not.toHaveProperty('endDate');      // canonical field is dateTo
  });

  it('shows a non-blocking «повторные сбои» chip when sync-store.hasRepeatedFailures is true', async () => {
    mockUseSyncStore.mockReturnValue({
      online: true, unsyncedCount: 2, needsAttentionCount: 0, lastSyncedAt: null, isSyncing: false, syncNow: vi.fn(),
      hasRepeatedFailures: true,
    });
    mockGetSalesHistory.mockResolvedValue([]);
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) });
    render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    expect(await screen.findByText(/повторные сбои/i)).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/pages/__tests__/HistoryPage.test.tsx`
      Expected failure: `Failed to resolve import "../HistoryPage"`.
- [ ] Create `sellary-cashier/src/pages/HistoryPage.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getSalesHistory, getHistoryAggregates } from '../lib/db';
import type { LocalSale, HistoryFilter } from '../lib/db';
import { useSyncStore } from '../lib/sync-store';
import { SyncStatusTabs } from '../components/history/SyncStatusTabs';
import type { SyncFilter } from '../components/history/SyncStatusTabs';
import { FilterMenu } from '../components/history/FilterMenu';
import type { PaymentFilter } from '../components/history/FilterMenu';
import { KpiCards } from '../components/history/KpiCards';
import { HourlyChart } from '../components/history/HourlyChart';
import { SalesTable } from '../components/history/SalesTable';
import { SaleDetailPanel } from '../components/history/SaleDetailPanel';

const PAGE_SIZE = 50;
const EMPTY_AGG = { turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) };

export function HistoryPage() {
  const navigate = useNavigate();
  const { online, needsAttentionCount, isSyncing, syncNow, hasRepeatedFailures } = useSyncStore();

  const [syncFilter, setSyncFilter] = useState<SyncFilter>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentFilter>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [sales, setSales] = useState<LocalSale[]>([]);
  const [aggregates, setAggregates] = useState(EMPTY_AGG);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Canonical HistoryFilter (INDEX §4.5): dateFrom/dateTo (NOT startDate/endDate), and paymentMethod
  // OMITTED for the «Все» tab — never send the literal 'all'. limit/offset are added at each call site.
  const baseOpts = useMemo<Omit<HistoryFilter, 'limit' | 'offset'>>(
    () => ({
      syncFilter,
      paymentMethod: paymentMethod !== 'all' ? paymentMethod : undefined,
      dateFrom: startDate || undefined,
      dateTo: endDate || undefined,
      search: debouncedSearch.trim() || undefined,
    }),
    [syncFilter, paymentMethod, startDate, endDate, debouncedSearch],
  );

  const reqRef = useRef(0);
  useEffect(() => {
    const token = ++reqRef.current;
    setLoading(true);
    Promise.all([
      getSalesHistory({ ...baseOpts, limit: PAGE_SIZE, offset: 0 }),
      // HistoryFilter (INDEX §4.5) requires limit/offset; getHistoryAggregates aggregates over the
      // WHOLE active filter and ignores them — pass placeholders only to satisfy the required shape.
      getHistoryAggregates({ ...baseOpts, limit: PAGE_SIZE, offset: 0 }),
    ]).then(([page, agg]) => {
      if (token !== reqRef.current) return; // stale response
      setSales(page);
      setAggregates(agg);
      setOffset(page.length);
      setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
    });
  }, [baseOpts]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const token = reqRef.current;
    const next = await getSalesHistory({ ...baseOpts, limit: PAGE_SIZE, offset });
    if (token === reqRef.current) {
      setSales((prev) => [...prev, ...next]);
      setOffset((prev) => prev + next.length);
      setHasMore(next.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [baseOpts, offset]);

  const resetFilters = () => {
    setPaymentMethod('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={() => navigate('/cashier')} className="text-sm text-blue-600">← Касса</button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">История продаж</h1>
        {!online && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Оффлайн</span>
        )}
        {/* Non-blocking chip (INDEX §5 / spec §4.7): retries keep running in the background. */}
        {hasRepeatedFailures && (
          <span
            title="Некоторые продажи повторно не отправляются. Автоповтор продолжается."
            className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
          >
            Повторные сбои
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <SyncStatusTabs value={syncFilter} onChange={setSyncFilter} needsAttentionCount={needsAttentionCount} />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по номеру чека…"
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <FilterMenu
                paymentMethod={paymentMethod}
                startDate={startDate}
                endDate={endDate}
                onPaymentMethodChange={setPaymentMethod}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onReset={resetFilters}
              />
              <button
                type="button"
                onClick={() => syncNow()}
                disabled={isSyncing}
                className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <ArrowPathIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{isSyncing ? 'Синхронизация…' : 'Обновить'}</span>
              </button>
            </div>
          </div>

          <KpiCards
            turnover={aggregates.turnover}
            count={aggregates.count}
            unsynced={aggregates.unsynced}
            onUnsyncedClick={() => setSyncFilter('unsynced')}
          />

          <HourlyChart hourly={aggregates.hourly} />

          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {loading ? (
              <div className="p-12 text-center text-gray-400">Загрузка…</div>
            ) : (
              <SalesTable
                sales={sales}
                selectedId={selectedId}
                onRowClick={(s) => setSelectedId(s.id)}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
              />
            )}
          </div>
        </div>

        {selectedId != null && <SaleDetailPanel saleId={selectedId} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/pages/__tests__/HistoryPage.test.tsx`
- [ ] Run the whole history suite to catch cross-file regressions: `npx vitest run src/components/history src/pages/__tests__/HistoryPage.test.tsx`
- [ ] Commit:
  - `git add src/pages/HistoryPage.tsx src/pages/__tests__/HistoryPage.test.tsx`
  - `git commit -m "feat(cashier): add HistoryPage with aggregate-over-filter KPIs"`

---

### Task 11: Verify `/history` route + POS nav are wired by earlier plans (NO edits here)

Per INDEX §3, `src/App.tsx` (owner: **offline-auth**) already contains the `/history` route, and the POS-header `История` → `/history` nav link is owned by **pos-ui**. Because this plan merges LAST, both already exist. **Do NOT edit `App.tsx` or `POSPage.tsx`** — that would collide with their sole owners. This task is verification only.

**Files:** none.

Steps:
- [ ] Confirm the canonical `App.tsx` already routes `/history` to `HistoryPage` (offline-auth's final route list per INDEX §3 is `/login`, `/cashier`, `/pin-setup`, `/pin-unlock`, `/history`, `/settings`, catch-all → `/login`). If `/history` is missing, STOP — offline-auth has not merged; the merge order (INDEX §2) is violated.
- [ ] Confirm the pos-ui-rewritten `POSPage.tsx` header has an `История` → `/history` nav link (and keeps its `Settings` link). If missing, that is a pos-ui gap — flag it there; do NOT add it from this plan.
- [ ] Type-only compile check that `HistoryPage` slots into the existing route: `npx tsc --noEmit` (confirm no new errors in `src/pages/HistoryPage.tsx`; pre-existing errors in files owned by other plans are out of scope).

---

### Task 12: SettingsPage needs-attention management list

`NeedsAttentionList` is the authoritative management home (spec §8.4): per-row **Повторить отправку** (force-resend via `requestSync`) and **Отметить решённым** (acknowledge via `acknowledgeSale`). **No delete** (compliance). Wired into `SettingsPage` plus a "История продаж" nav link. Built as a self-contained component so it does not collide with the sync-engine plan's SettingsPage sync-section rewrite.

**Files:**
- Create: `sellary-cashier/src/components/history/NeedsAttentionList.tsx`
- Test: `sellary-cashier/src/components/history/__tests__/NeedsAttentionList.test.tsx`
- Modify: `sellary-cashier/src/pages/SettingsPage.tsx`

Steps:
- [ ] Write the failing test `.../__tests__/NeedsAttentionList.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGetSalesHistory, mockAcknowledgeSale, mockRequestSync } = vi.hoisted(() => ({
  mockGetSalesHistory: vi.fn(),
  mockAcknowledgeSale: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getSalesHistory: mockGetSalesHistory,
  acknowledgeSale: mockAcknowledgeSale,
}));
vi.mock('../../../lib/sync-engine', () => ({ requestSync: mockRequestSync }));

import { NeedsAttentionList } from '../NeedsAttentionList';

function permanentSale(over = {}) {
  return {
    id: 5, client_sale_id: 'zzz', idempotency_key: 'i', receipt_no: 99, server_sale_id: null,
    subtotal: 200, discount_amount: 0, tax_amount: 0, total_amount: 200, paid_amount: 200, change_amount: 0,
    payment_method: 'cash', card_type: null, notes: null, cashier_user_id: null, cashier_username: null,
    sync_status: 'failed', error_kind: 'permanent', next_attempt_at: null, first_failed_at: null,
    last_error: 'Products not found', retry_count: 4, stock_applied: 1,
    created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null, updated_at: '2026-07-10T09:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  mockAcknowledgeSale.mockResolvedValue(undefined);
  mockRequestSync.mockResolvedValue(undefined);
});

describe('NeedsAttentionList', () => {
  it('renders each needs-attention sale with its error', async () => {
    mockGetSalesHistory.mockResolvedValue([permanentSale()]);
    render(<NeedsAttentionList />);
    expect(await screen.findByText('Products not found')).toBeInTheDocument();
    expect(mockGetSalesHistory).toHaveBeenCalledWith(expect.objectContaining({ syncFilter: 'attention' }));
  });
  it('resend triggers a forced sync', async () => {
    mockGetSalesHistory.mockResolvedValue([permanentSale()]);
    render(<NeedsAttentionList />);
    fireEvent.click(await screen.findByRole('button', { name: /Повторить отправку/ }));
    await waitFor(() => expect(mockRequestSync).toHaveBeenCalledWith('manual', { force: true }));
  });
  it('acknowledge calls acknowledgeSale with the id and never deletes', async () => {
    mockGetSalesHistory.mockResolvedValue([permanentSale()]);
    render(<NeedsAttentionList />);
    fireEvent.click(await screen.findByRole('button', { name: /Отметить решённым/ }));
    await waitFor(() => expect(mockAcknowledgeSale).toHaveBeenCalledWith(5));
    expect(screen.queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
  });
  it('shows an all-clear state when empty', async () => {
    mockGetSalesHistory.mockResolvedValue([]);
    render(<NeedsAttentionList />);
    expect(await screen.findByText(/Все продажи синхронизированы/)).toBeInTheDocument();
  });
});
```
- [ ] Run and see it FAIL: `npx vitest run src/components/history/__tests__/NeedsAttentionList.test.tsx`
      Expected failure: `Failed to resolve import "../NeedsAttentionList"`.
- [ ] Create `sellary-cashier/src/components/history/NeedsAttentionList.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { getSalesHistory, acknowledgeSale } from '../../lib/db';
import type { LocalSale } from '../../lib/db';
import { requestSync } from '../../lib/sync-engine';
import { formatCurrency } from '../../lib/format';

export function NeedsAttentionList() {
  const [rows, setRows] = useState<LocalSale[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const list = await getSalesHistory({ syncFilter: 'attention', limit: 50, offset: 0 });
    setRows(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResend = async (id: number) => {
    setBusyId(id);
    try {
      await requestSync('manual', { force: true });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleAcknowledge = async (id: number) => {
    setBusyId(id);
    try {
      await acknowledgeSale(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (rows.length === 0) {
    return <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-400 dark:border-gray-700">Все продажи синхронизированы.</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map((s) => (
        <div key={s.id} className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">Чек #{s.receipt_no}</span>
            <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(s.total_amount)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">{new Date(s.created_at_client).toLocaleString('ru-RU')}</p>
          {s.last_error && <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{s.last_error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busyId === s.id}
              onClick={() => handleResend(s.id)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Повторить отправку
            </button>
            <button
              type="button"
              disabled={busyId === s.id}
              onClick={() => handleAcknowledge(s.id)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
            >
              Отметить решённым
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```
- [ ] Run and see it PASS: `npx vitest run src/components/history/__tests__/NeedsAttentionList.test.tsx`
- [ ] Edit `sellary-cashier/src/pages/SettingsPage.tsx` — add the import at the top (after the existing imports):
```tsx
import { NeedsAttentionList } from '../components/history/NeedsAttentionList';
```
- [ ] Edit `sellary-cashier/src/pages/SettingsPage.tsx` — inside the header row, add a "История продаж" nav link. Replace:
```tsx
          <button
            onClick={() => navigate('/cashier', { replace: true })}
            className="text-sm text-blue-600"
          >
            Back to POS
          </button>
```
with:
```tsx
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/history')} className="text-sm text-blue-600">
              История продаж
            </button>
            <button
              onClick={() => navigate('/cashier', { replace: true })}
              className="text-sm text-blue-600"
            >
              Back to POS
            </button>
          </div>
```
- [ ] Edit `sellary-cashier/src/pages/SettingsPage.tsx` — render the management list. Immediately after the closing `</div>` of the "Sync" card (the `<div className="bg-white rounded-lg border p-4">` block ending the page body), add a new card before the container closes:
```tsx
        <div className="bg-white rounded-lg border p-4 mt-4 dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-sm font-medium mb-2">Требует внимания</h2>
          <p className="text-xs text-gray-400 mb-3">
            Продажи, которые сервер отклонил. Отправьте повторно или отметьте решёнными. Удаление недоступно.
          </p>
          <NeedsAttentionList />
        </div>
```
- [ ] Compile-check: `npx tsc --noEmit` (confirm no new errors in `SettingsPage.tsx` from the wiring).
- [ ] Run the full cashier suite: `npm test`
      Expected: all history + settings tests pass (pre-existing failures owned by other plans, if any, are out of scope).
- [ ] Commit:
  - `git add src/components/history/NeedsAttentionList.tsx src/components/history/__tests__/NeedsAttentionList.test.tsx src/pages/SettingsPage.tsx`
  - `git commit -m "feat(cashier): needs-attention management list in Settings (resend + acknowledge)"`

---

## Final verification

- [ ] Run the whole cashier vitest suite once more: `npm test` (run from `sellary-cashier/`).
- [ ] Manual gate (needs Rust; do NOT automate): `npm run tauri:dev`, log in/provision, complete a few sales, open **История**, confirm: tabs filter, KPIs/hourly reflect the full filter, load-more works, the detail slide-over shows the receipt from the snapshot (rename/delete a product server-side + refresh catalog → receipt unchanged), Повторить/Печать work, and Settings → «Требует внимания» resend/acknowledge behave.
