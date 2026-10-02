# Инвентаризация history page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A «Инвентаризация» page listing every counted-stock correction — flat or grouped by product — with four filters and a product search, so the owner can see which products get corrected over and over, by whom.

**Architecture:** One new server flag (`stocktake_only`) narrows the existing `GET /api/inventory/logs` to counted-stock rows; the page loads that once and does all filtering, searching and grouping in the browser. No new endpoint, no new table, no migration.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / pytest (backend); Next.js 14 App Router / TypeScript / TanStack Query / vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-15-stocktake-history-design.md`

---

## Before you start

**Environment.** Backend commands run from `sellary-backend/` with the venv active.
On Windows the binaries are `.venv\Scripts\python.exe` and `.venv\Scripts\pytest.exe`
(this plan writes `pytest` for brevity — use the venv path). Test isolation is
transaction rollback, so inside a test use `session.flush()`, never
`session.commit()`. Frontend commands run from `sellary-frontend/`.

**Two rules from the spec that govern the whole plan:**

1. **The server's only job is narrowing the row set.** Do not add a date, reason
   or user filter to the endpoint. Those live in the browser, on a few hundred
   rows, and adding them server-side is the scope creep this design exists to
   avoid.
2. **`STOCKTAKE_REFERENCE_TYPES` is derived from the `StocktakeReason` enum**, not
   hand-listed. A new reason added to the enum must not be able to silently fall
   out of this page.

**Do not touch** `sellary-frontend/src/components/inventory/StockHistorySheet.tsx`.
It keeps its own job (one product's *full* movement history, opened from the
products page). This page shows only counts, and expands a grouped row from rows
already in memory — the spec explains why reusing the sheet would cost a second
fetch per click.

## File structure

| File | Responsibility |
|---|---|
| `sellary-backend/schemas/inventory_log.py` | modify — add `STOCKTAKE_REFERENCE_TYPES`, derived from the enum |
| `sellary-backend/repositories/inventory_repository.py` | modify — one filter clause in `get_logs` |
| `sellary-backend/services/inventory_service.py` | modify — pass the flag through, no logic |
| `sellary-backend/api/inventory.py` | modify — the query param, and the `limit` ceiling |
| `sellary-frontend/src/lib/stocktakeHistory.ts` | **new** — the pure functions: filter, search, group. No React. |
| `sellary-frontend/src/app/(protected)/stocktakes/page.tsx` | **new** — the page: state, two views, filter panel |
| `sellary-frontend/src/lib/moduleNav.ts` | modify — one nav entry |

The pure functions live in their own file so the grouping and filtering rules are
testable without rendering anything — the page then holds only state and markup.

---

### Task 1: `STOCKTAKE_REFERENCE_TYPES`

**Why:** The page needs one authoritative answer to "what counts as
инвентаризация". `StocktakeReason` (`schemas/inventory_log.py:33`) already defines
the four reasons, and `apply_stocktake` writes `reason.value` straight into
`inventory_logs.reference_type`. `manual_adjust` joins them as the removed
edit-form channel — the one that put 146 corrections into production — because an
audit page that omits the known-bad rows is worse than one that shows them.

Deriving the tuple from the enum is the point: hand-listing the four strings would
let a fifth reason be added to the enum and silently never appear on this page.

**Files:**
- Modify: `sellary-backend/schemas/inventory_log.py`
- Test: `sellary-backend/tests/unit/test_stocktake_reference_types.py`

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_stocktake_reference_types.py`:

```python
"""What the Инвентаризация page is allowed to call a count."""
from schemas.inventory_log import STOCKTAKE_REFERENCE_TYPES, StocktakeReason


def test_every_stocktake_reason_is_included():
    """Adding a reason to the enum must not silently drop it from the page."""
    for reason in StocktakeReason:
        assert reason.value in STOCKTAKE_REFERENCE_TYPES


def test_the_removed_edit_form_channel_is_included():
    """146 of these reached production; hiding them makes the audit a lie."""
    assert "manual_adjust" in STOCKTAKE_REFERENCE_TYPES


def test_ordinary_movements_are_excluded():
    for reference_type in ("sale", "po_receive", "write_off", "product_initial"):
        assert reference_type not in STOCKTAKE_REFERENCE_TYPES
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_stocktake_reference_types.py -v`
Expected: FAIL — `ImportError: cannot import name 'STOCKTAKE_REFERENCE_TYPES'`.

- [ ] **Step 3: Write the implementation**

In `sellary-backend/schemas/inventory_log.py`, add immediately after the
`STOCKTAKE_REASON_LABELS` dict (around line 58):

```python
# What the Инвентаризация page reads back. Derived from the enum rather than
# hand-listed, so a new reason cannot be added above and forgotten here.
# `manual_adjust` is the removed edit-form quantity box — a dead channel, but its
# rows are real corrections to counted stock and an audit that omits them is
# worse than one that shows them.
STOCKTAKE_REFERENCE_TYPES: tuple[str, ...] = tuple(
    reason.value for reason in StocktakeReason
) + ("manual_adjust",)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_stocktake_reference_types.py -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/schemas/inventory_log.py sellary-backend/tests/unit/test_stocktake_reference_types.py
git commit -m "feat(inventory): name the movement types a count produces"
```

---

### Task 2: `stocktake_only` on the query

**Why:** Every sale line writes an `inventory_log` row, so a shop ringing ~1000
receipts a month has thousands of movement rows while counts number in the low
hundreds. Filtering counts out in the browser would mean downloading the whole
movement history to find a handful of rows. One `in_()` clause avoids that.

**Files:**
- Modify: `sellary-backend/repositories/inventory_repository.py:16-45`
- Modify: `sellary-backend/services/inventory_service.py:161-175`
- Modify: `sellary-backend/api/inventory.py:132-145`
- Test: `sellary-backend/tests/integration/test_inventory_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_inventory_endpoints.py`:

```python
class TestStocktakeOnlyLogs:
    """The Инвентаризация page asks for counts and must not get sales."""

    def _log(self, db_session, default_company, admin_user, test_product, reference_type):
        from decimal import Decimal

        from models.inventory_log import InventoryLog

        row = InventoryLog(
            company_id=default_company.id,
            product_id=test_product.id,
            user_id=admin_user.id,
            quantity_change=Decimal("-2.000"),
            value_change=Decimal("-10.00"),
            previous_quantity=Decimal("10.000"),
            new_quantity=Decimal("8.000"),
            reason="test",
            reference_type=reference_type,
        )
        db_session.add(row)
        db_session.flush()
        return row

    def test_it_returns_counts_and_excludes_sales(
        self, client, db_session, default_company, admin_user, test_product, manager_headers
    ):
        counted = self._log(
            db_session, default_company, admin_user, test_product, "shortage"
        )
        sold = self._log(db_session, default_company, admin_user, test_product, "sale")

        body = client.get(
            "/api/inventory/logs",
            params={"stocktake_only": True},
            headers=manager_headers,
        ).json()

        ids = [row["id"] for row in body]
        assert counted.id in ids
        assert sold.id not in ids

    def test_every_counted_reference_type_comes_back(
        self, client, db_session, default_company, admin_user, test_product, manager_headers
    ):
        from schemas.inventory_log import STOCKTAKE_REFERENCE_TYPES

        expected = {
            self._log(
                db_session, default_company, admin_user, test_product, reference_type
            ).id
            for reference_type in STOCKTAKE_REFERENCE_TYPES
        }

        body = client.get(
            "/api/inventory/logs",
            params={"stocktake_only": True, "limit": 200},
            headers=manager_headers,
        ).json()

        assert expected <= {row["id"] for row in body}

    def test_receipts_and_write_offs_stay_out(
        self, client, db_session, default_company, admin_user, test_product, manager_headers
    ):
        unwanted = {
            self._log(
                db_session, default_company, admin_user, test_product, reference_type
            ).id
            for reference_type in ("po_receive", "write_off", "product_initial")
        }

        body = client.get(
            "/api/inventory/logs",
            params={"stocktake_only": True, "limit": 200},
            headers=manager_headers,
        ).json()

        assert not unwanted & {row["id"] for row in body}

    def test_the_default_is_unchanged_for_existing_callers(
        self, client, db_session, default_company, admin_user, test_product, manager_headers
    ):
        """StockHistorySheet still asks without the flag and still gets sales."""
        sold = self._log(db_session, default_company, admin_user, test_product, "sale")

        body = client.get("/api/inventory/logs", headers=manager_headers).json()

        assert sold.id in [row["id"] for row in body]

    def test_it_composes_with_product_id(
        self,
        client,
        db_session,
        default_company,
        admin_user,
        test_products_bulk,
        manager_headers,
    ):
        first, second = test_products_bulk[0], test_products_bulk[1]
        mine = self._log(db_session, default_company, admin_user, first, "stocktake")
        theirs = self._log(db_session, default_company, admin_user, second, "stocktake")

        body = client.get(
            "/api/inventory/logs",
            params={"stocktake_only": True, "product_id": first.id},
            headers=manager_headers,
        ).json()

        ids = [row["id"] for row in body]
        assert mine.id in ids
        assert theirs.id not in ids

    def test_the_limit_ceiling_is_a_thousand(
        self, client, default_company, manager_headers
    ):
        assert (
            client.get(
                "/api/inventory/logs",
                params={"limit": 1000},
                headers=manager_headers,
            ).status_code
            == 200
        )
        assert (
            client.get(
                "/api/inventory/logs",
                params={"limit": 1001},
                headers=manager_headers,
            ).status_code
            == 422
        )
```

`test_it_composes_with_product_id` needs a second product. Open
`sellary-backend/tests/conftest.py` and use whichever second-product fixture
exists (look around the `test_product` fixture, roughly line 424); rename the
parameter to match. If there is none, create the second product inline the way
`test_product` does and back it with `_back_product_with_opening_layer`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_inventory_endpoints.py::TestStocktakeOnlyLogs -v`
Expected: FAIL — `stocktake_only` is an unknown query param, so it is ignored and
`test_it_returns_counts_and_excludes_sales` finds the sale row in the response;
`test_the_limit_ceiling_is_a_thousand` fails because `limit=1000` is still a 422.

- [ ] **Step 3: Write the repository change**

In `sellary-backend/repositories/inventory_repository.py`, extend the import at
the top:

```python
from schemas.inventory_log import STOCKTAKE_REFERENCE_TYPES
```

Change `get_logs`'s signature and add the clause beside the existing `sale_id`
one:

```python
    def get_logs(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        product_id: Optional[int] = None,
        sale_id: Optional[int] = None,
        stocktake_only: bool = False,
    ) -> tuple[List[InventoryLog], int]:
        query = self.db.query(InventoryLog).options(
            joinedload(InventoryLog.product), joinedload(InventoryLog.user)
        ).filter(InventoryLog.company_id == company_id)

        if product_id:
            query = query.filter(InventoryLog.product_id == product_id)

        if stocktake_only:
            # Counting stock is rare; every sale line writes a row. Narrowing
            # here is what keeps the Инвентаризация page from downloading the
            # whole movement history to find a handful of rows.
            query = query.filter(
                InventoryLog.reference_type.in_(STOCKTAKE_REFERENCE_TYPES)
            )
```

Leave the `sale_id` block, the `order_by`, the `count()` and the return exactly as
they are.

- [ ] **Step 4: Write the service change**

In `sellary-backend/services/inventory_service.py`, `get_logs` (line 161):

```python
    def get_logs(
        self,
        skip: int = 0,
        limit: int = 50,
        product_id: int = None,
        sale_id: int = None,
        stocktake_only: bool = False,
    ) -> Tuple[List[InventoryLog], int]:
        logs, total = self.inventory_repo.get_logs(
            self.company_id,
            skip=skip,
            limit=limit,
            product_id=product_id,
            sale_id=sale_id,
            stocktake_only=stocktake_only,
        )
        return [self._log_to_response(log) for log in logs], total
```

- [ ] **Step 5: Write the endpoint change**

In `sellary-backend/api/inventory.py`, `get_inventory_logs` (line 132):

```python
@router.get("/logs", response_model=list[InventoryLog])
def get_inventory_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    product_id: Optional[int] = None,
    sale_id: Optional[int] = Query(None, ge=1, description="Номер чека"),
    stocktake_only: bool = Query(
        False, description="Только инвентаризация: пересчёт, излишек, недостача"
    ),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = InventoryService(db, auth.company_id)
    logs, _ = service.get_logs(
        skip=skip,
        limit=limit,
        product_id=product_id,
        sale_id=sale_id,
        stocktake_only=stocktake_only,
    )
    return logs
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/integration/test_inventory_endpoints.py::TestStocktakeOnlyLogs -v`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the whole backend suite and the compile gate**

Run: `pytest tests/integration tests/unit`
Expected: PASS. The raised `limit` ceiling and the new default-`False` param are
both backwards compatible, so nothing else should move.

Run: `python -m compileall api core models repositories schemas services main.py`
Expected: no errors. This is the CI gate.

- [ ] **Step 8: Commit**

```bash
git add sellary-backend/repositories/inventory_repository.py sellary-backend/services/inventory_service.py sellary-backend/api/inventory.py sellary-backend/tests/integration/test_inventory_endpoints.py
git commit -m "feat(inventory): ask the log for counts alone"
```

---

### Task 3: The filter, search and group functions

**Why:** These rules are the page's actual behaviour, and they are pure functions
over an array. Putting them in their own module means they can be tested without
rendering anything, and the page file stays state plus markup.

**Files:**
- Create: `sellary-frontend/src/lib/stocktakeHistory.ts`
- Test: `sellary-frontend/src/lib/__tests__/stocktakeHistory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/lib/__tests__/stocktakeHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InventoryLog } from '@/lib/types';
import { applyFilters, groupByProduct } from '../stocktakeHistory';

const log = (over: Partial<InventoryLog> = {}): InventoryLog => ({
  id: 1,
  product_id: 4,
  product_name: 'Сахар 1кг',
  user_id: 2,
  user_name: 'Shohrom',
  quantity_change: '-2.000',
  value_change: '-10.00',
  previous_quantity: '10.000',
  new_quantity: '8.000',
  reason: null,
  reference_type: 'shortage',
  reference_id: null,
  created_at: '2026-08-14T09:00:00Z',
  ...over,
});

const NO_FILTERS = {
  from: '',
  to: '',
  reason: 'all',
  user: 'all',
  direction: 'all' as const,
  search: '',
};

describe('applyFilters', () => {
  it('keeps everything when nothing is set', () => {
    const rows = [log(), log({ id: 2, reference_type: 'surplus' })];

    expect(applyFilters(rows, NO_FILTERS)).toHaveLength(2);
  });

  it('matches the product name case-insensitively', () => {
    const rows = [log(), log({ id: 2, product_name: 'Курут Танга' })];

    const found = applyFilters(rows, { ...NO_FILTERS, search: 'сахар' });

    expect(found.map((row) => row.id)).toEqual([1]);
  });

  it('filters by reason', () => {
    const rows = [log(), log({ id: 2, reference_type: 'surplus' })];

    const found = applyFilters(rows, { ...NO_FILTERS, reason: 'surplus' });

    expect(found.map((row) => row.id)).toEqual([2]);
  });

  it('filters by who did it', () => {
    const rows = [log(), log({ id: 2, user_name: 'Алишер' })];

    const found = applyFilters(rows, { ...NO_FILTERS, user: 'Алишер' });

    expect(found.map((row) => row.id)).toEqual([2]);
  });

  it('splits излишек from недостача on the sign', () => {
    const rows = [log(), log({ id: 2, quantity_change: '3.000' })];

    expect(applyFilters(rows, { ...NO_FILTERS, direction: 'up' }).map((r) => r.id)).toEqual([2]);
    expect(applyFilters(rows, { ...NO_FILTERS, direction: 'down' }).map((r) => r.id)).toEqual([1]);
  });

  it('includes both ends of the date range', () => {
    const rows = [
      log({ id: 1, created_at: '2026-08-13T23:30:00Z' }),
      log({ id: 2, created_at: '2026-08-14T09:00:00Z' }),
      log({ id: 3, created_at: '2026-08-15T09:00:00Z' }),
    ];

    const found = applyFilters(rows, {
      ...NO_FILTERS,
      from: '2026-08-14',
      to: '2026-08-15',
    });

    expect(found.map((row) => row.id).sort()).toEqual([2, 3]);
  });

  it('combines filters', () => {
    const rows = [
      log({ id: 1, reference_type: 'surplus', quantity_change: '3.000' }),
      log({ id: 2, reference_type: 'surplus', quantity_change: '-3.000' }),
    ];

    const found = applyFilters(rows, {
      ...NO_FILTERS,
      reason: 'surplus',
      direction: 'up',
    });

    expect(found.map((row) => row.id)).toEqual([1]);
  });
});

describe('groupByProduct', () => {
  it('sums the changes per product', () => {
    const rows = [
      log({ id: 1, quantity_change: '-2.000', value_change: '-10.00' }),
      log({ id: 2, quantity_change: '-3.000', value_change: '-15.00' }),
    ];

    const [group] = groupByProduct(rows);

    expect(group.product_id).toBe(4);
    expect(group.count).toBe(2);
    expect(group.quantity_change).toBeCloseTo(-5);
    expect(group.value_change).toBeCloseTo(-25);
  });

  it('orders the most-corrected product first', () => {
    const rows = [
      log({ id: 1, product_id: 4, product_name: 'Сахар' }),
      log({ id: 2, product_id: 9, product_name: 'Курут' }),
      log({ id: 3, product_id: 9, product_name: 'Курут' }),
    ];

    expect(groupByProduct(rows).map((group) => group.product_id)).toEqual([9, 4]);
  });

  it('reports the latest count as the product date', () => {
    const rows = [
      log({ id: 1, created_at: '2026-08-10T09:00:00Z' }),
      log({ id: 2, created_at: '2026-08-14T09:00:00Z' }),
    ];

    expect(groupByProduct(rows)[0].last_at).toBe('2026-08-14T09:00:00Z');
  });

  it('carries the rows so a row can expand without refetching', () => {
    const rows = [log({ id: 1 }), log({ id: 2 })];

    expect(groupByProduct(rows)[0].rows.map((row) => row.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/stocktakeHistory.test.ts`
Expected: FAIL — `Failed to resolve import "../stocktakeHistory"`.

- [ ] **Step 3: Write the implementation**

Create `sellary-frontend/src/lib/stocktakeHistory.ts`:

```ts
import type { InventoryLog } from '@/lib/types';

export type Direction = 'all' | 'up' | 'down';

export interface StocktakeFilters {
  from: string;
  to: string;
  reason: string;
  user: string;
  direction: Direction;
  search: string;
}

export interface ProductGroup {
  product_id: number;
  product_name: string;
  count: number;
  quantity_change: number;
  value_change: number;
  last_at: string;
  rows: InventoryLog[];
}

/**
 * The row's own calendar day, as `YYYY-MM-DD`.
 *
 * Deliberately the browser's clock: it is the clock the row's timestamp is
 * rendered on beside it, so the filter can never disagree with the date the
 * user is reading.
 */
const localDay = (value: string) => {
  const at = new Date(value);
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
};

export function applyFilters(
  rows: InventoryLog[],
  filters: StocktakeFilters,
): InventoryLog[] {
  const needle = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (needle && !row.product_name.toLowerCase().includes(needle)) return false;
    if (filters.reason !== 'all' && row.reference_type !== filters.reason) return false;
    if (filters.user !== 'all' && row.user_name !== filters.user) return false;

    const change = Number(row.quantity_change);
    if (filters.direction === 'up' && change <= 0) return false;
    if (filters.direction === 'down' && change >= 0) return false;

    const day = localDay(row.created_at);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;

    return true;
  });
}

/** One row per product, most-corrected first — that ordering is the signal. */
export function groupByProduct(rows: InventoryLog[]): ProductGroup[] {
  const groups = new Map<number, ProductGroup>();

  for (const row of rows) {
    const existing = groups.get(row.product_id);
    if (existing) {
      existing.count += 1;
      existing.quantity_change += Number(row.quantity_change);
      existing.value_change += Number(row.value_change);
      existing.rows.push(row);
      if (row.created_at > existing.last_at) existing.last_at = row.created_at;
    } else {
      groups.set(row.product_id, {
        product_id: row.product_id,
        product_name: row.product_name,
        count: 1,
        quantity_change: Number(row.quantity_change),
        value_change: Number(row.value_change),
        last_at: row.created_at,
        rows: [row],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/stocktakeHistory.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-frontend/src/lib/stocktakeHistory.ts sellary-frontend/src/lib/__tests__/stocktakeHistory.test.ts
git commit -m "feat(inventory): the rules behind the Инвентаризация page"
```

---

### Task 4: The «Инвентаризация» page

**Why:** This is the surface the owner asked for. It loads once and every control
reads the same array, so the summary line always describes exactly what is on
screen.

**Files:**
- Create: `sellary-frontend/src/app/(protected)/stocktakes/page.tsx`
- Modify: `sellary-frontend/src/lib/moduleNav.ts:42-50`

- [ ] **Step 1: Write the page**

Create `sellary-frontend/src/app/(protected)/stocktakes/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { inventoryApi } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { STOCK_MOVEMENT_LABELS } from '@/lib/stockMovements';
import {
  applyFilters,
  groupByProduct,
  type Direction,
  type StocktakeFilters,
} from '@/lib/stocktakeHistory';
import { formatCurrency } from '@/lib/utils';
import { CardSkeleton, TableSkeleton } from '@/components/skeletons';
import FilterMenu from '@/components/filters/FilterMenu';
import QueryError from '@/components/ui/QueryError';
import { ModuleGuard } from '@/components/ModuleGuard';
import type { InventoryLog } from '@/lib/types';

// The endpoint's ceiling. A full count of a 485-product catalogue is 485 rows,
// so this is roughly two years of monthly counts — and when it is reached the
// page says so rather than truncating in silence.
const ROW_CAP = 1000;

const REASONS = ['stocktake', 'surplus', 'shortage', 'other', 'manual_adjust'];

const EMPTY: StocktakeFilters = {
  from: '',
  to: '',
  reason: 'all',
  user: 'all',
  direction: 'all',
  search: '',
};

type View = 'list' | 'products';

const signed = (value: number, digits = 3) =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;

const fieldClass =
  'min-h-[40px] w-full border-2 border-[var(--erp-divider)] px-2 text-sm text-[var(--erp-text)] focus:border-[var(--erp-accent)] focus:outline-none';

function Stocktakes() {
  const [view, setView] = useState<View>('list');
  const [filters, setFilters] = useState<StocktakeFilters>(EMPTY);
  const [searchInput, setSearchInput] = useState('');
  const [openProductId, setOpenProductId] = useState<number | null>(null);
  const search = useDebounce(searchInput, 300);

  const query = useQuery<InventoryLog[]>({
    queryKey: ['stocktakes'],
    queryFn: async () =>
      (await inventoryApi.getLogs({ stocktake_only: true, limit: ROW_CAP })).data,
  });

  const rows = query.data ?? [];
  const filtered = useMemo(
    () => applyFilters(rows, { ...filters, search }),
    [rows, filters, search],
  );
  const groups = useMemo(() => groupByProduct(filtered), [filtered]);
  const users = useMemo(
    () => [...new Set(rows.map((row) => row.user_name))].sort(),
    [rows],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          quantity: sum.quantity + Number(row.quantity_change),
          value: sum.value + Number(row.value_change),
        }),
        { quantity: 0, value: 0 },
      ),
    [filtered],
  );

  const activeCount = [
    filters.from || filters.to,
    filters.reason !== 'all',
    filters.user !== 'all',
    filters.direction !== 'all',
  ].filter(Boolean).length;

  const set = <K extends keyof StocktakeFilters>(key: K, value: StocktakeFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="h-full space-y-4 overflow-y-auto mobile-no-overscroll p-4">
      <div>
        <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">
          Инвентаризация
        </h2>
        <p className="mt-0.5 max-w-[70ch] text-sm text-[var(--erp-muted)]">
          Каждый пересчёт остатка: что насчитали, на сколько это разошлось с учётом
          и кто считал. Товар, который правят чаще других, стоит первым во вкладке
          «По товарам».
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Поиск по товару"
          aria-label="Поиск по товару"
          className="min-h-[40px] w-full max-w-xs border-2 border-[var(--erp-divider)] px-3 text-sm text-[var(--erp-text)] focus:border-[var(--erp-accent)] focus:outline-none"
        />

        <FilterMenu
          activeCount={activeCount}
          onReset={() => setFilters(EMPTY)}
          className="ml-auto"
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]">
                Период
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="date"
                  aria-label="С даты"
                  value={filters.from}
                  onChange={(event) => set('from', event.target.value)}
                  className={fieldClass}
                />
                <input
                  type="date"
                  aria-label="По дату"
                  value={filters.to}
                  onChange={(event) => set('to', event.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="stocktake-reason"
                className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]"
              >
                Причина
              </label>
              <select
                id="stocktake-reason"
                value={filters.reason}
                onChange={(event) => set('reason', event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="all">Все</option>
                {REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {STOCK_MOVEMENT_LABELS[reason] ?? reason}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="stocktake-user"
                className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]"
              >
                Кто
              </label>
              <select
                id="stocktake-user"
                value={filters.user}
                onChange={(event) => set('user', event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="all">Все</option>
                {users.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="stocktake-direction"
                className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]"
              >
                Направление
              </label>
              <select
                id="stocktake-direction"
                value={filters.direction}
                onChange={(event) => set('direction', event.target.value as Direction)}
                className={`${fieldClass} mt-1`}
              >
                <option value="all">Все</option>
                <option value="up">Излишек (+)</option>
                <option value="down">Недостача (−)</option>
              </select>
            </div>
          </div>
        </FilterMenu>
      </div>

      {query.isLoading ? (
        <CardSkeleton />
      ) : query.isError ? (
        <QueryError what="инвентаризацию" onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="border-2 border-[var(--erp-divider)] bg-white p-3 text-sm tabular-nums dark:bg-gray-800">
            {filtered.length} пересчётов · {signed(totals.quantity)} ед. ·{' '}
            {formatCurrency(totals.value)}
          </div>

          {rows.length >= ROW_CAP && (
            <div
              role="status"
              className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-3 text-[13px] leading-snug"
            >
              Показаны последние {ROW_CAP} записей — более старые пересчёты сюда не
              попали.
            </div>
          )}

          <div className="flex gap-1 border-b border-[var(--erp-divider)]">
            {([
              ['list', 'Список'],
              ['products', 'По товарам'],
            ] as [View, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`-mb-px h-10 border-b-2 px-4 text-sm font-medium ${
                  view === key
                    ? 'border-[var(--erp-accent)] text-[var(--erp-text)] dark:text-white'
                    : 'border-transparent text-[var(--erp-muted)] hover:text-[var(--erp-text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
              {rows.length === 0
                ? 'Пересчётов остатка ещё не было.'
                : 'Под выбранные фильтры ничего не подошло.'}
            </div>
          ) : view === 'list' ? (
            <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Товар</th>
                    <th className="px-4 py-3">Причина</th>
                    <th className="px-4 py-3 text-right">Было → стало</th>
                    <th className="px-4 py-3 text-right">Разница</th>
                    <th className="px-4 py-3 text-right">Сумма</th>
                    <th className="px-4 py-3">Кто</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const change = Number(row.quantity_change);
                    return (
                      <tr
                        key={row.id}
                        className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--erp-muted)]">
                          {new Date(row.created_at).toLocaleString('ru-RU')}
                        </td>
                        <td className="px-4 py-3 font-medium">{row.product_name}</td>
                        <td className="px-4 py-3">
                          {STOCK_MOVEMENT_LABELS[row.reference_type ?? ''] ?? 'Изменение'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                          {row.previous_quantity} → {row.new_quantity}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                            change < 0 ? 'text-[#dc2626]' : 'text-[var(--erp-success)]'
                          }`}
                        >
                          {signed(change)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {formatCurrency(row.value_change)}
                        </td>
                        <td className="px-4 py-3 text-[var(--erp-muted)]">{row.user_name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div
                  key={group.product_id}
                  className="border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800"
                >
                  <button
                    onClick={() =>
                      setOpenProductId(
                        openProductId === group.product_id ? null : group.product_id,
                      )
                    }
                    aria-expanded={openProductId === group.product_id}
                    className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 p-4 text-left hover:bg-[var(--erp-surface)]"
                  >
                    <span className="font-semibold text-[var(--erp-text)]">
                      {group.product_name}
                    </span>
                    <span className="text-xs text-[var(--erp-muted)]">
                      {group.count} пересчётов
                    </span>
                    <span
                      className={`ml-auto text-sm font-semibold tabular-nums ${
                        group.quantity_change < 0
                          ? 'text-[#dc2626]'
                          : 'text-[var(--erp-success)]'
                      }`}
                    >
                      {signed(group.quantity_change)} ед.
                    </span>
                    <span className="text-sm tabular-nums">
                      {formatCurrency(group.value_change)}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--erp-muted)]">
                      {new Date(group.last_at).toLocaleDateString('ru-RU')}
                    </span>
                  </button>

                  {openProductId === group.product_id && (
                    <ol className="space-y-2 border-t border-[var(--erp-divider)] p-4">
                      {group.rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-[var(--erp-divider)] p-3 text-sm"
                        >
                          <span className="tabular-nums text-[var(--erp-muted)]">
                            {new Date(row.created_at).toLocaleString('ru-RU')}
                          </span>
                          <span>
                            {STOCK_MOVEMENT_LABELS[row.reference_type ?? ''] ?? 'Изменение'}
                          </span>
                          <span className="tabular-nums text-[var(--erp-muted)]">
                            {row.previous_quantity} → {row.new_quantity}
                          </span>
                          <span
                            className={`font-semibold tabular-nums ${
                              Number(row.quantity_change) < 0
                                ? 'text-[#dc2626]'
                                : 'text-[var(--erp-success)]'
                            }`}
                          >
                            {signed(Number(row.quantity_change))}
                          </span>
                          <span className="text-[var(--erp-muted)]">{row.user_name}</span>
                          {row.reason && (
                            <span className="w-full text-[var(--erp-text)]">{row.reason}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function StocktakesPage() {
  return (
    <ModuleGuard module="inventory">
      <Stocktakes />
    </ModuleGuard>
  );
}
```

- [ ] **Step 2: Add the nav entry**

In `sellary-frontend/src/lib/moduleNav.ts`, extend the `inventory` group (line
42-50). Its tagline already says «инвентаризация», so the page finally has a
home:

```ts
  {
    key: 'inventory',
    label: 'Склад',
    tagline: 'Товары, категории, инвентаризация',
    pages: [
      { label: 'Товары', href: '/products' },
      { label: 'Инвентаризация', href: '/stocktakes' },
      { label: 'Списания', href: '/write-offs' },
    ],
  },
```

- [ ] **Step 3: Verify types, tests, build and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS, whole suite.

Run: `npm run build`
Expected: build succeeds and `/stocktakes` appears in the route list.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Verify by hand**

Start the backend and frontend, count a product's stock a few times from
`/products` (including once up and once down), then open `/stocktakes`:

- «Список» shows each count with было→стало and the right sign colour;
- «По товарам» puts the most-counted product first and expands to its own rows;
- the reason, кто, direction and date filters each narrow both views, and the
  summary line changes with them;
- the search box narrows by product name;
- «Сбросить» in the filter panel clears the badge;
- a company with no counts shows «Пересчётов остатка ещё не было.»

- [ ] **Step 5: Commit**

```bash
git add "sellary-frontend/src/app/(protected)/stocktakes/page.tsx" sellary-frontend/src/lib/moduleNav.ts
git commit -m "feat(inventory): a page for every stock count"
```

---

### Task 5: Document the page

**Why:** `CLAUDE.md`'s «Counting stock» section explains why a count is a document
and why the reasons are what they are. It should say where those documents can now
be read, or the next person adds a second page for the same fact.

**Files:**
- Modify: `CLAUDE.md` — the «Counting stock» section
- Modify: `AGENTS.md` — the same section

- [ ] **Step 1: Add the paragraph to both files**

Append to the «Counting stock» section in `CLAUDE.md`, then mirror a one-sentence
version into `AGENTS.md`'s equivalent section:

```markdown
Counts are read back on `/stocktakes` («Инвентаризация», in the Склад nav group).
`GET /api/inventory/logs?stocktake_only=true` narrows the movement log to
`STOCKTAKE_REFERENCE_TYPES` — the four `StocktakeReason` values plus the removed
`manual_adjust` channel, whose 146 production rows are real corrections and are
shown rather than hidden. That flag is the server's only job here: the page loads
one page of rows and does its own date, reason, user, direction and search
filtering, because counts are rare while every sale line writes a log row.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: where stock counts are read back"
```

---

## Definition of done

- [ ] `pytest tests/integration tests/unit` passes from `sellary-backend/`
- [ ] `python -m compileall api core models repositories schemas services main.py` is clean
- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean from `sellary-frontend/`
- [ ] No new file under `alembic/versions/` — this plan adds no migration
- [ ] `git diff main --stat -- sellary-frontend/src/components/inventory/StockHistorySheet.tsx`
      is empty: the existing sheet was not touched
- [ ] `STOCKTAKE_REFERENCE_TYPES` is built from the enum, not hand-listed
