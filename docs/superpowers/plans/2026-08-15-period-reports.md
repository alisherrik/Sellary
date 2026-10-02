# Периоды сверки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shop owner a «Периоды» page where every сверка is a closed period showing what was bought against what was sold, and stop a сверка from hiding settled history on the two existing report pages.

**Architecture:** A period is derived, never stored. `services/reconciliation.py` gains the single predicate that turns consecutive `company_reconciliations` rows into `(start_day, end_day)` windows; a new `services/period_report_service.py` composes the existing `ReportService` and `PurchaseReportService` over that window. No migration, no new column, no snapshot.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2 Core-style `select()` / pytest (backend); Next.js 14 App Router / TypeScript / TanStack Query / vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-15-period-reports-and-mcp-parity-design.md`

---

## Before you start

Read the spec. Two rules from it govern every task here:

1. **Derive, never snapshot.** No figure computed in this plan is written to a column. If
   you find yourself adding a `total_sold` field to `company_reconciliations`, stop — the
   spec explains at length why that is the drift this codebase keeps learning not to build.
2. **One predicate, one floor.** `services/reconciliation.py` says so in its own module
   docstring. The period boundary goes in that file, next to `open_from`. Do not compute
   `effective_from - 1 day` anywhere else.

**Environment.** All backend commands run from `sellary-backend/` with the venv active.
On Windows the binaries are `.venv\Scripts\python.exe` and `.venv\Scripts\pytest.exe`.
Backend tests use transaction rollback for isolation, so inside a test use
`session.flush()`, never `session.commit()`. Frontend commands run from
`sellary-frontend/`.

## File structure

| File | Responsibility |
|---|---|
| `sellary-frontend/src/lib/reportWindow.ts` | **new** — turns an «за N дней» preset into an explicit start instant. One function. |
| `sellary-frontend/src/hooks/useQueries.ts` | modify — the three report hooks send that start |
| `sellary-frontend/src/app/(protected)/purchase-report/page.tsx` | modify — the three purchase queries send that start |
| `sellary-backend/services/reconciliation.py` | modify — add `Period`, `periods()`, `period()` |
| `sellary-backend/services/period_report_service.py` | **new** — composes the existing report services over one period |
| `sellary-backend/schemas/reconciliation.py` | modify — `PeriodRow`, `PeriodList`, `PeriodDetail`, `LateArrivals` |
| `sellary-backend/api/reconciliation.py` | modify — two GET routes, no logic |
| `sellary-frontend/src/lib/api.ts` | modify — two calls on `reconciliationApi` |
| `sellary-frontend/src/lib/types.ts` | modify — the matching TS types |
| `sellary-frontend/src/app/(protected)/periods/page.tsx` | **new** — the «Периоды» page |
| `sellary-frontend/src/lib/moduleNav.ts` | modify — one nav entry |
| `sellary-frontend/src/components/ReconciliationNotice.tsx` | modify — link to `/periods` |

---

# PR 1 — the settled history stops disappearing

Ships on its own. Independently valuable: it un-hides pre-сверка data on `/reports` and
`/purchase-report` today.

Branch: `fix/report-window-explicit-start`

### Task 1: A preset resolves to an explicit start instant

**Why:** `period_range` (`sellary-backend/services/company_time.py:51`) fills a **missing**
start with the сверка cut-off. Both report pages send only `days`, so every request is a
defaulted range and «за 90 дней» quietly means «с даты сверки». The floor is deliberate and
pinned by `tests/unit/test_reconciliation_period.py` — we do not touch it. We send a start.

Only the start is computed in the browser. `end_date` stays empty so the server fills it on
the **company** clock, which the browser does not know (`timezone` appears nowhere in
`sellary-frontend/src`).

**Files:**
- Create: `sellary-frontend/src/lib/reportWindow.ts`
- Test: `sellary-frontend/src/lib/__tests__/reportWindow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/lib/__tests__/reportWindow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { windowStart } from '../reportWindow';

describe('windowStart', () => {
  it('starts N-1 days back, at local midnight', () => {
    // 90 days ending 15 Aug 2026 inclusive => first day is 18 May 2026.
    const start = new Date(windowStart(90, new Date(2026, 7, 15, 14, 30)));

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(18);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('a one-day window is today', () => {
    const start = new Date(windowStart(1, new Date(2026, 7, 15, 14, 30)));

    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
  });

  it('crosses a month boundary', () => {
    const start = new Date(windowStart(7, new Date(2026, 7, 3, 9, 0)));

    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(28);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/reportWindow.test.ts`
Expected: FAIL — `Failed to resolve import "../reportWindow"`.

- [ ] **Step 3: Write the implementation**

Create `sellary-frontend/src/lib/reportWindow.ts`:

```ts
/**
 * The first day of an «за N дней» window, as an instant.
 *
 * Sent explicitly because the server floors a MISSING start at the
 * reconciliation cut-off — which is how a сверка made «за 90 дней» quietly mean
 * «с даты сверки». The end is deliberately left to the server: it knows the
 * company timezone and the browser does not.
 */
export function windowStart(days: number, now: Date = new Date()): string {
  const first = new Date(now);
  first.setDate(first.getDate() - Math.max(days - 1, 0));
  first.setHours(0, 0, 0, 0);
  return first.toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/reportWindow.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-frontend/src/lib/reportWindow.ts sellary-frontend/src/lib/__tests__/reportWindow.test.ts
git commit -m "feat(reports): name the first day of a report window"
```

---

### Task 2: The sales report hooks send the start

**Files:**
- Modify: `sellary-frontend/src/hooks/useQueries.ts:366-406`
- Test: `sellary-frontend/src/hooks/__tests__/useQueries.test.tsx:438-482`

- [ ] **Step 1: Update the existing assertions so they fail**

In `sellary-frontend/src/hooks/__tests__/useQueries.test.tsx`, replace the three
`toHaveBeenCalledWith` assertions in `describe('Report Hooks …')`:

```ts
        expect(api.reportsApi.getDailySales).toHaveBeenCalledWith(
            expect.objectContaining({ days: 7, start_date: expect.any(String) })
        );
```

```ts
        expect(api.reportsApi.getProfit).toHaveBeenCalledWith(
            expect.objectContaining({ days: 30, start_date: expect.any(String) })
        );
```

```ts
        expect(api.reportsApi.getTopProducts).toHaveBeenCalledWith(
            expect.objectContaining({ days: 7, limit: 10, start_date: expect.any(String) })
        );
```

Then add one test that pins the behaviour rather than the shape. Put it inside the same
`describe` block:

```ts
    it('sends a start that is N-1 days back, so the server does not floor it', async () => {
        vi.mocked(api.reportsApi.getProfit).mockResolvedValue(createMockAxiosResponse({}));

        const { result } = renderHook(() => useProfit(90), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const sent = vi.mocked(api.reportsApi.getProfit).mock.calls[0][0] as {
            start_date: string;
        };
        const expected = new Date();
        expected.setDate(expected.getDate() - 89);
        expected.setHours(0, 0, 0, 0);

        expect(new Date(sent.start_date).getTime()).toBe(expected.getTime());
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/useQueries.test.tsx -t "Report Hooks"`
Expected: FAIL — the calls carry only `{ days: … }`, so `objectContaining` with
`start_date` does not match.

- [ ] **Step 3: Write the implementation**

In `sellary-frontend/src/hooks/useQueries.ts`, add the import beside the existing ones at
the top:

```ts
import { windowStart } from '@/lib/reportWindow';
```

Then change the three query functions (lines 372, 386, 400):

```ts
            const response = await reportsApi.getDailySales({ days, start_date: windowStart(days) });
```

```ts
            const response = await reportsApi.getProfit({ days, start_date: windowStart(days) });
```

```ts
            const response = await reportsApi.getTopProducts({ days, limit, start_date: windowStart(days) });
```

Leave the query keys as they are: the start is derived from `days`, so it adds nothing to
the cache identity.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useQueries.test.tsx`
Expected: PASS, whole file green.

- [ ] **Step 5: Commit**

```bash
git add sellary-frontend/src/hooks/useQueries.ts sellary-frontend/src/hooks/__tests__/useQueries.test.tsx
git commit -m "fix(reports): ask for the window the button names"
```

---

### Task 3: The purchase report sends the start

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/purchase-report/page.tsx:65-89`

There is no test file for this page. The change is three call sites of a function already
covered by Task 1's tests, so verification is a build plus a manual check.

- [ ] **Step 1: Write the implementation**

In `sellary-frontend/src/app/(protected)/purchase-report/page.tsx`, add the import beside
the existing `@/lib/*` imports:

```ts
import { windowStart } from '@/lib/reportWindow';
```

Inside `PurchaseReportPage`, add one line after the `days` state and pass it to the three
period-scoped queries. `outstanding` takes no period and is left alone.

```tsx
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>('products');
  const start_date = windowStart(days);

  const summary = useQuery<PurchaseSummary>({
    queryKey: ['purchase-report', 'summary', days],
    queryFn: async () => (await purchaseReportApi.summary({ days, start_date })).data,
  });

  const byProduct = useQuery<PurchaseByProductRow[]>({
    queryKey: ['purchase-report', 'by-product', days],
    queryFn: async () => (await purchaseReportApi.byProduct({ days, start_date, limit: 500 })).data,
    enabled: tab === 'products',
  });

  const bySupplier = useQuery<PurchaseBySupplierRow[]>({
    queryKey: ['purchase-report', 'by-supplier', days],
    queryFn: async () => (await purchaseReportApi.bySupplier({ days, start_date })).data,
    enabled: tab === 'suppliers',
  });
```

`purchaseReportApi` already types `start_date` on all three (`src/lib/api.ts:453,455,462`) —
no change is needed there.

- [ ] **Step 2: Verify the build and the types**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 3: Verify by hand against a reconciled company**

Start the backend and frontend, open `/purchase-report` on a company that has a сверка, and
press «90 дней». The date line under the buttons (rendered from the server's
`period_start` / `period_end`) must show a start ~90 days back, not the сверка date.

Do the same on `/reports`: the «Общая выручка с … по …» line must span the full window.

- [ ] **Step 4: Commit**

```bash
git add "sellary-frontend/src/app/(protected)/purchase-report/page.tsx"
git commit -m "fix(purchases): the period buttons mean what they say after a сверка"
```

---

### Task 4: Regression test on the backend

**Why:** Task 1–3 are frontend. Nothing on the backend proves that an explicit start
survives a сверка, and a future refactor of `period_range` could quietly re-clamp it. The
existing `test_an_explicit_start_is_honoured` covers the service; this covers the endpoint.

**Files:**
- Test: `sellary-backend/tests/integration/test_reports_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_reports_endpoints.py` (create the file
with the imports below if it does not exist):

```python
from datetime import datetime, timedelta

from models.reconciliation import Reconciliation
from services import reconciliation


class TestSettledHistoryStaysReadable:
    """A сверка closes a period for editing, never for reading."""

    def test_an_explicit_start_reaches_behind_the_cut_off(
        self, client, db_session, default_company, manager_headers
    ):
        cut_off = (datetime.utcnow() - timedelta(days=3)).date()
        db_session.add(
            Reconciliation(company_id=default_company.id, effective_from=cut_off)
        )
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)

        start = (datetime.utcnow() - timedelta(days=89)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        response = client.get(
            "/api/reports/profit",
            params={"days": 90, "start_date": start.isoformat()},
            headers=manager_headers,
        )

        assert response.status_code == 200
        assert response.json()["period_start"].startswith(start.date().isoformat())

    def test_without_a_start_the_floor_still_applies(
        self, client, db_session, default_company, manager_headers
    ):
        cut_off = (datetime.utcnow() - timedelta(days=3)).date()
        db_session.add(
            Reconciliation(company_id=default_company.id, effective_from=cut_off)
        )
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)

        response = client.get(
            "/api/reports/profit", params={"days": 90}, headers=manager_headers
        )

        assert response.status_code == 200
        assert response.json()["period_start"].startswith(cut_off.isoformat())
```

- [ ] **Step 2: Run the tests**

Run: `pytest tests/integration/test_reports_endpoints.py::TestSettledHistoryStaysReadable -v`
Expected: PASS, both. They document behaviour that already works; if either fails, the
floor is wrong and the frontend fix cannot help.

- [ ] **Step 3: Run the whole suite**

Run: `pytest tests/integration tests/unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add sellary-backend/tests/integration/test_reports_endpoints.py
git commit -m "test(reports): an explicit start reads behind the cut-off"
```

**PR 1 is complete.** Open it, get it merged, then start PR 2 from the updated base.

---

# PR 2 — Периоды

Branch: `feat/reconciliation-periods`

### Task 5: The period predicate

**Why:** No code anywhere fetches two consecutive `company_reconciliations` rows. Every
read of `effective_from` today is a `MAX()`. This is the one function that turns the table
into windows, and it lives beside `open_from` because that file already declares the rule:
*"two writers of one rule is how the sales page and the reports page come to disagree"*.

**Files:**
- Modify: `sellary-backend/services/reconciliation.py`
- Test: `sellary-backend/tests/unit/test_reconciliation_periods.py`

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_reconciliation_periods.py`:

```python
"""A period runs from the previous cut-off to the day before this one."""
from datetime import date

from models.reconciliation import Reconciliation
from services import reconciliation


def declare(db_session, company, day):
    row = Reconciliation(company_id=company.id, effective_from=day)
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)
    return row


def test_no_reconciliations_means_no_periods(db_session, default_company):
    assert reconciliation.periods(db_session, default_company.id) == []


def test_the_oldest_period_has_no_start(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))

    period = reconciliation.periods(db_session, default_company.id)[0]

    assert period.start_day is None
    assert period.end_day == date(2026, 4, 30)
    assert period.index == 1


def test_a_later_period_starts_where_the_previous_one_ended(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))
    declare(db_session, default_company, date(2026, 6, 1))

    newest, oldest = reconciliation.periods(db_session, default_company.id)

    assert newest.start_day == date(2026, 5, 1)
    assert newest.end_day == date(2026, 5, 31)
    assert newest.index == 2
    assert oldest.index == 1


def test_index_counts_from_the_oldest_so_it_does_not_shift(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))
    declare(db_session, default_company, date(2026, 6, 1))
    declare(db_session, default_company, date(2026, 7, 1))

    assert [p.index for p in reconciliation.periods(db_session, default_company.id)] == [3, 2, 1]


def test_another_company_is_not_visible(db_session, default_company, second_company):
    declare(db_session, second_company, date(2026, 5, 1))

    assert reconciliation.periods(db_session, default_company.id) == []


def test_period_finds_one_by_its_reconciliation_id(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))
    row = declare(db_session, default_company, date(2026, 6, 1))

    found = reconciliation.period(db_session, default_company.id, row.id)

    assert found.id == row.id
    assert found.start_day == date(2026, 5, 1)


def test_period_returns_none_for_an_unknown_id(db_session, default_company):
    assert reconciliation.period(db_session, default_company.id, 9999) is None
```

If there is no `second_company` fixture in `tests/conftest.py`, use the second company
fixture that exists there (see the fixture defined around `tests/conftest.py:148`) and
rename the parameter to match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/test_reconciliation_periods.py -v`
Expected: FAIL — `AttributeError: module 'services.reconciliation' has no attribute 'periods'`.

- [ ] **Step 3: Write the implementation**

In `sellary-backend/services/reconciliation.py`, extend the imports:

```python
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional
```

Then append to the file:

```python
@dataclass(frozen=True)
class Period:
    """A settled window, closed by one reconciliation.

    `start_day` is None for the oldest: it covers everything the shop recorded
    before its first сверка, and inventing a start would be a claim about when
    the shop opened.
    """

    id: int
    index: int
    start_day: Optional[date]
    end_day: date
    effective_from: date
    note: Optional[str]
    created_at: datetime
    created_by_user_id: Optional[int]


def periods(db: Session, company_id: int) -> list[Period]:
    """Closed periods, newest first.

    Loaded whole rather than paged: `index` counts from the oldest so that
    «Сверка №1» keeps its number as new ones are declared, and that cannot be
    computed from a page. A shop reconciles monthly at most.
    """
    rows = list(
        db.execute(
            select(Reconciliation)
            .where(Reconciliation.company_id == company_id)
            .order_by(Reconciliation.effective_from, Reconciliation.id)
        ).scalars()
    )
    built = [
        Period(
            id=row.id,
            index=position + 1,
            start_day=rows[position - 1].effective_from if position else None,
            end_day=row.effective_from - timedelta(days=1),
            effective_from=row.effective_from,
            note=row.note,
            created_at=row.created_at,
            created_by_user_id=row.created_by_user_id,
        )
        for position, row in enumerate(rows)
    ]
    built.reverse()
    return built


def period(db: Session, company_id: int, reconciliation_id: int) -> Optional[Period]:
    return next(
        (item for item in periods(db, company_id) if item.id == reconciliation_id),
        None,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/test_reconciliation_periods.py -v`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/services/reconciliation.py sellary-backend/tests/unit/test_reconciliation_periods.py
git commit -m "feat(reconciliation): a period is the window one сверка closed"
```

---

### Task 6: The period report service — list

**Why:** The router must not compose three services; that is business logic. This service
owns "what did this window buy and sell", and it does so by calling the reports that
already answer it. It stores nothing.

**Files:**
- Create: `sellary-backend/services/period_report_service.py`
- Modify: `sellary-backend/schemas/reconciliation.py`
- Test: `sellary-backend/tests/unit/test_period_report_service.py`

- [ ] **Step 1: Write the schemas**

Append to `sellary-backend/schemas/reconciliation.py`, and extend its imports to
`from decimal import Decimal`:

```python
class PeriodRow(BaseModel):
    id: int
    index: int
    start_day: Optional[date] = None
    end_day: date
    note: Optional[str] = None
    purchased: Decimal
    sold: Decimal


class PeriodList(BaseModel):
    total: int
    periods: list[PeriodRow] = []
```

- [ ] **Step 2: Write the failing test**

Create `sellary-backend/tests/unit/test_period_report_service.py`:

```python
"""A period's figures are the reports it is made of, recomputed on every read."""
from datetime import date, datetime, timedelta
from decimal import Decimal

from models.reconciliation import Reconciliation
from models.sale import PaymentMethod, Sale, SaleStatus
from services import reconciliation
from services.period_report_service import PeriodReportService
from tests.conftest import add_sale_tenders


def declare(db_session, company, day):
    row = Reconciliation(company_id=company.id, effective_from=day)
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)
    return row


def sell(db_session, cashier, when, amount="10.00"):
    sale = Sale(
        cashier_id=cashier.id,
        subtotal=Decimal(amount),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(amount),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=when,
    )
    db_session.add(sale)
    db_session.flush()
    return add_sale_tenders(db_session, sale)


def test_no_reconciliations_means_an_empty_list(db_session, default_company):
    result = PeriodReportService(db_session, default_company.id).list()

    assert result.total == 0
    assert result.periods == []


def test_a_sale_inside_the_window_is_counted(db_session, default_company, cashier_user):
    inside = datetime.utcnow() - timedelta(days=5)
    sell(db_session, cashier_user, inside, "40.00")
    declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())

    row = PeriodReportService(db_session, default_company.id).list().periods[0]

    assert row.sold == Decimal("40.00")


def test_a_sale_after_the_cut_off_is_not(db_session, default_company, cashier_user):
    declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())
    sell(db_session, cashier_user, datetime.utcnow(), "40.00")

    row = PeriodReportService(db_session, default_company.id).list().periods[0]

    assert row.sold == Decimal("0.00")


def test_a_sale_on_the_last_settled_day_is_counted(
    db_session, default_company, cashier_user
):
    """The boundary: end_day runs to 23:59:59.999999 local."""
    end_day = datetime.utcnow() - timedelta(days=1)
    sell(db_session, cashier_user, end_day.replace(hour=23, minute=30), "7.00")
    declare(db_session, default_company, datetime.utcnow().date())

    row = PeriodReportService(db_session, default_company.id).list().periods[0]

    assert row.sold == Decimal("7.00")


def test_the_page_is_newest_first_and_total_counts_them_all(
    db_session, default_company
):
    declare(db_session, default_company, date(2026, 5, 1))
    declare(db_session, default_company, date(2026, 6, 1))
    declare(db_session, default_company, date(2026, 7, 1))

    result = PeriodReportService(db_session, default_company.id).list(limit=2)

    assert result.total == 3
    assert [row.index for row in result.periods] == [3, 2]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/unit/test_period_report_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.period_report_service'`.

- [ ] **Step 4: Write the implementation**

Create `sellary-backend/services/period_report_service.py`:

```python
"""What a closed period bought and what it sold.

Every figure is recomputed from the reports it is made of. Nothing is stored on
`company_reconciliations`: a settled total with no independent source is exactly
the drift this codebase keeps learning not to build, and the maintenance scripts
write behind the freeze — a derived report shows the repaired truth, a frozen
column would disagree with every other screen forever.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from schemas.reconciliation import PeriodList, PeriodRow
from services import reconciliation
from services.company_time import company_tz, local_day_bounds
from services.purchase_report_service import PurchaseReportService
from services.report_service import ReportService
from services.tenant import resolve_company_id

# The oldest period has no start. Every report service requires one, so the
# window opens at an instant no shop has a document before, rather than each
# report growing a nullable-start branch.
_BEGINNING = date(1970, 1, 1)


class PeriodReportService:
    def __init__(self, db: Session, company_id: Optional[int] = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self._tz = company_tz(db, self.company_id)

    def list(self, limit: int = 12, offset: int = 0) -> PeriodList:
        found = reconciliation.periods(self.db, self.company_id)
        return PeriodList(
            total=len(found),
            periods=[self._row(item) for item in found[offset : offset + limit]],
        )

    def _bounds(self, item) -> tuple[datetime, datetime]:
        start, _ = local_day_bounds(self._tz, item.start_day or _BEGINNING)
        _, end = local_day_bounds(self._tz, item.end_day)
        return start, end

    def _row(self, item) -> PeriodRow:
        start, end = self._bounds(item)
        return PeriodRow(
            id=item.id,
            index=item.index,
            start_day=item.start_day,
            end_day=item.end_day,
            note=item.note,
            purchased=PurchaseReportService(self.db, self.company_id)
            .summary(start, end)
            .total_spend,
            sold=ReportService(self.db, self.company_id)
            .get_profit_report(start, end)
            .revenue,
        )
```

Note on cost: `_row` runs two aggregate reports per period, so a page of 12 is a few dozen
indexed aggregates. That is why the default page is 12 — a year of monthly сверки — and not
50. If it ever becomes slow, the fix is a narrower spend query, not a stored column.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/unit/test_period_report_service.py -v`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/services/period_report_service.py sellary-backend/schemas/reconciliation.py sellary-backend/tests/unit/test_period_report_service.py
git commit -m "feat(reports): what a closed period bought and sold"
```

---

### Task 7: The period detail

**Why:** The card shows two numbers; opening it must answer «почему». It also surfaces
`checker_report`, a column written since the сверка feature shipped and never read back
through the API.

**Files:**
- Modify: `sellary-backend/services/period_report_service.py`
- Modify: `sellary-backend/schemas/reconciliation.py`
- Test: `sellary-backend/tests/unit/test_period_report_service.py`

- [ ] **Step 1: Write the schemas**

Append to `sellary-backend/schemas/reconciliation.py`:

```python
class LateArrivals(BaseModel):
    """Receipts dated inside the period that reached the server after it closed.

    Named rather than absorbed — the same move the shift panel makes with its
    own `late_arrivals` line.
    """

    count: int = 0
    total: Decimal = Decimal("0.00")


class PeriodDetail(BaseModel):
    id: int
    index: int
    start_day: Optional[date] = None
    end_day: date
    effective_from: date
    note: Optional[str] = None
    declared_at: datetime
    declared_by: Optional[str] = None

    purchased: Decimal
    receipts_count: int

    # Already net of returns. `returns_total` below is informational; never
    # subtract it again.
    sold: Decimal
    sales_count: int
    cost: Decimal
    profit: Decimal
    write_off_cost: Decimal
    profit_after_write_offs: Decimal
    returns_total: Decimal

    late_arrivals: LateArrivals
    checker_report: Optional[list] = None
```

- [ ] **Step 2: Write the failing test**

Append to `sellary-backend/tests/unit/test_period_report_service.py`:

```python
def test_detail_returns_none_for_an_unknown_id(db_session, default_company):
    assert PeriodReportService(db_session, default_company.id).detail(9999) is None


def test_detail_carries_the_author_and_the_note(
    db_session, default_company, admin_user
):
    row = Reconciliation(
        company_id=default_company.id,
        effective_from=date(2026, 6, 1),
        note="Июньская сверка",
        created_by_user_id=admin_user.id,
    )
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, default_company.id)

    detail = PeriodReportService(db_session, default_company.id).detail(row.id)

    assert detail.note == "Июньская сверка"
    assert detail.declared_by == (admin_user.full_name or admin_user.username)
    assert detail.effective_from == date(2026, 6, 1)


def test_detail_sold_matches_the_profit_report_over_the_same_bounds(
    db_session, default_company, cashier_user
):
    """The derived-not-stored guarantee, asserted."""
    from services.report_service import ReportService
    from services.company_time import company_tz, local_day_bounds

    sell(db_session, cashier_user, datetime.utcnow() - timedelta(days=5), "31.00")
    row = declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())

    detail = PeriodReportService(db_session, default_company.id).detail(row.id)

    tz = company_tz(db_session, default_company.id)
    start, _ = local_day_bounds(tz, date(1970, 1, 1))
    _, end = local_day_bounds(tz, row.effective_from - timedelta(days=1))
    direct = ReportService(db_session, default_company.id).get_profit_report(start, end)

    assert detail.sold == direct.revenue
    assert detail.profit == direct.profit
    assert detail.write_off_cost == direct.write_off_cost


def test_detail_reports_the_returns_that_happened_inside_the_window(
    db_session, default_company, cashier_user
):
    from models.sale_return import SaleReturn

    sale = sell(db_session, cashier_user, datetime.utcnow() - timedelta(days=5), "50.00")
    db_session.add(
        SaleReturn(
            company_id=default_company.id,
            sale_id=sale.id,
            total_refund_amount=Decimal("12.00"),
            created_at=datetime.utcnow() - timedelta(days=4),
        )
    )
    db_session.flush()
    row = declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())

    detail = PeriodReportService(db_session, default_company.id).detail(row.id)

    assert detail.returns_total == Decimal("12.00")


def test_detail_surfaces_a_checker_report(db_session, default_company):
    row = Reconciliation(
        company_id=default_company.id,
        effective_from=date(2026, 6, 1),
        checker_report=[{"bucket": "drift", "name": "stock_vs_layers"}],
    )
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, default_company.id)

    detail = PeriodReportService(db_session, default_company.id).detail(row.id)

    assert detail.checker_report == [{"bucket": "drift", "name": "stock_vs_layers"}]
```

`SaleReturn` may require more non-nullable columns than the three set above. Open
`sellary-backend/models/sale_return.py` and fill in whatever else is `nullable=False`
(`refund_method` is a native Postgres enum — pass the enum member, not a string).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/unit/test_period_report_service.py -v -k detail`
Expected: FAIL — `AttributeError: 'PeriodReportService' object has no attribute 'detail'`.

- [ ] **Step 4: Write the implementation**

In `sellary-backend/services/period_report_service.py`, extend the imports:

```python
from decimal import Decimal

from sqlalchemy import func, select

from models.sale_return import SaleReturn
from models.user import User
from schemas.reconciliation import LateArrivals, PeriodDetail, PeriodList, PeriodRow
```

Then add to the class:

```python
    def detail(self, reconciliation_id: int) -> Optional[PeriodDetail]:
        item = reconciliation.period(self.db, self.company_id, reconciliation_id)
        if item is None:
            return None

        start, end = self._bounds(item)
        purchases = PurchaseReportService(self.db, self.company_id).summary(start, end)
        profit = ReportService(self.db, self.company_id).get_profit_report(start, end)

        return PeriodDetail(
            id=item.id,
            index=item.index,
            start_day=item.start_day,
            end_day=item.end_day,
            effective_from=item.effective_from,
            note=item.note,
            declared_at=item.created_at,
            declared_by=self._author(item.created_by_user_id),
            purchased=purchases.total_spend,
            receipts_count=purchases.receipts_count,
            sold=profit.revenue,
            sales_count=profit.sales_count,
            cost=profit.cost,
            profit=profit.profit,
            write_off_cost=profit.write_off_cost,
            profit_after_write_offs=profit.profit_after_write_offs,
            returns_total=self._returns(start, end),
            late_arrivals=LateArrivals(),
            checker_report=self._checker_report(item.id),
        )

    def _author(self, user_id: Optional[int]) -> Optional[str]:
        if user_id is None:
            return None
        row = self.db.execute(
            select(User.full_name, User.username).where(User.id == user_id)
        ).first()
        if row is None:
            return None
        return row.full_name or row.username

    def _returns(self, start: datetime, end: datetime) -> Decimal:
        return self.db.execute(
            select(
                func.coalesce(func.sum(SaleReturn.total_refund_amount), Decimal("0.00"))
            ).where(
                SaleReturn.company_id == self.company_id,
                SaleReturn.created_at >= start,
                SaleReturn.created_at <= end,
            )
        ).scalar() or Decimal("0.00")

    def _checker_report(self, reconciliation_id: int) -> Optional[list]:
        return self.db.execute(
            select(Reconciliation.checker_report).where(
                Reconciliation.id == reconciliation_id,
                Reconciliation.company_id == self.company_id,
            )
        ).scalar()
```

and extend the model import at the top:

```python
from models.reconciliation import Reconciliation
```

`late_arrivals` is a zeroed placeholder here and is filled in by Task 8. Do not ship the
detail endpoint before Task 8 lands — a hard-coded zero is a lie about a settled period.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/unit/test_period_report_service.py -v`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/services/period_report_service.py sellary-backend/schemas/reconciliation.py sellary-backend/tests/unit/test_period_report_service.py
git commit -m "feat(reports): open a closed period and see what it was made of"
```

---

### Task 8: Late arrivals

**Why:** An offline sale that syncs after the cut-off is accepted at its own timestamp by
design (`services/sync_service.py`), so a settled period's `sold` can grow after
settlement. Naming the residual is what makes it findable — the same move
`CashShiftService.compute_totals` makes with its own `late_arrivals` line, and the reason
the 396.49 backfill bug was ever caught.

The arrival proxy is `MIN(sale_payments.created_at)`, the one `ConsistencyService` already
uses (`services/consistency_service.py:324`). Its known blind spot — a synced sale with no
tender rows — is the checker's problem. Do not invent a second proxy.

**Files:**
- Modify: `sellary-backend/services/period_report_service.py`
- Test: `sellary-backend/tests/unit/test_period_report_service.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/unit/test_period_report_service.py`:

```python
def test_a_receipt_that_arrived_after_the_freeze_is_named(
    db_session, default_company, cashier_user
):
    from models.sale_payment import SalePayment

    row = declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())

    # Dated inside the settled period, but its tender rows were written after
    # the сверка — that is what "arrived late" means.
    late = sell(db_session, cashier_user, datetime.utcnow() - timedelta(days=3), "18.00")
    db_session.query(SalePayment).filter(SalePayment.sale_id == late.id).update(
        {"created_at": row.created_at + timedelta(minutes=1)}
    )
    db_session.flush()

    detail = PeriodReportService(db_session, default_company.id).detail(row.id)

    assert detail.late_arrivals.count == 1
    assert detail.late_arrivals.total == Decimal("18.00")


def test_a_receipt_that_arrived_before_the_freeze_is_not(
    db_session, default_company, cashier_user
):
    from models.sale_payment import SalePayment

    early = sell(db_session, cashier_user, datetime.utcnow() - timedelta(days=3), "18.00")
    row = declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())
    db_session.query(SalePayment).filter(SalePayment.sale_id == early.id).update(
        {"created_at": row.created_at - timedelta(minutes=1)}
    )
    db_session.flush()

    detail = PeriodReportService(db_session, default_company.id).detail(row.id)

    assert detail.late_arrivals.count == 0
    assert detail.late_arrivals.total == Decimal("0.00")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/test_period_report_service.py -v -k late`
Expected: FAIL — `assert 0 == 1`, because `detail` still returns `LateArrivals()`.

- [ ] **Step 3: Write the implementation**

In `sellary-backend/services/period_report_service.py`, extend the imports:

```python
from models.sale import Sale
from models.sale_payment import SalePayment
from repositories.sale_repository import NON_CANCELLED_STATUSES
```

Replace `late_arrivals=LateArrivals(),` in `detail` with:

```python
            late_arrivals=self._late_arrivals(item, start, end),
```

and add the method:

```python
    def _late_arrivals(self, item, start: datetime, end: datetime) -> LateArrivals:
        """Sales dated inside the period whose tenders were written after the freeze.

        A `sale_payments` row is stamped when the server accepts the sale, so
        the earliest one is when the receipt actually reached us. A sale rung
        offline carries its own `created_at` and is never rewritten — the spec
        explains why rewriting it would be worse.
        """
        arrival = (
            select(
                SalePayment.sale_id.label("sale_id"),
                func.min(SalePayment.created_at).label("arrived_at"),
            )
            .group_by(SalePayment.sale_id)
            .subquery()
        )
        count, total = self.db.execute(
            select(
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.total_amount), Decimal("0.00")),
            )
            .join(arrival, arrival.c.sale_id == Sale.id)
            .where(
                Sale.company_id == self.company_id,
                Sale.created_at >= start,
                Sale.created_at <= end,
                Sale.status.in_(NON_CANCELLED_STATUSES),
                arrival.c.arrived_at > item.created_at,
            )
        ).one()
        return LateArrivals(count=int(count or 0), total=total or Decimal("0.00"))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/test_period_report_service.py -v`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/services/period_report_service.py sellary-backend/tests/unit/test_period_report_service.py
git commit -m "feat(reports): name the receipts that arrived after a period closed"
```

---

### Task 9: The two endpoints

**Files:**
- Modify: `sellary-backend/api/reconciliation.py`
- Test: `sellary-backend/tests/integration/test_reconciliation_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_reconciliation_endpoints.py` (create it
with these imports if it does not exist):

```python
from datetime import date, datetime, timedelta

from models.reconciliation import Reconciliation
from services import reconciliation


def declare(db_session, company, day, **extra):
    row = Reconciliation(company_id=company.id, effective_from=day, **extra)
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)
    return row


class TestPeriodEndpoints:
    def test_list_is_empty_before_the_first_сверка(
        self, client, default_company, manager_headers
    ):
        response = client.get("/api/reconciliation/periods", headers=manager_headers)

        assert response.status_code == 200
        assert response.json() == {"total": 0, "periods": []}

    def test_list_returns_newest_first_with_both_figures(
        self, client, db_session, default_company, manager_headers
    ):
        declare(db_session, default_company, date(2026, 5, 1))
        declare(db_session, default_company, date(2026, 6, 1))

        body = client.get(
            "/api/reconciliation/periods", headers=manager_headers
        ).json()

        assert body["total"] == 2
        assert [row["index"] for row in body["periods"]] == [2, 1]
        assert body["periods"][0]["start_day"] == "2026-05-01"
        assert body["periods"][0]["end_day"] == "2026-05-31"
        assert body["periods"][1]["start_day"] is None
        assert "purchased" in body["periods"][0]
        assert "sold" in body["periods"][0]

    def test_detail_is_addressable_by_its_reconciliation_id(
        self, client, db_session, default_company, manager_headers
    ):
        row = declare(db_session, default_company, date(2026, 6, 1), note="Июнь")

        body = client.get(
            f"/api/reconciliation/periods/{row.id}", headers=manager_headers
        ).json()

        assert body["id"] == row.id
        assert body["note"] == "Июнь"
        assert body["late_arrivals"]["count"] == 0

    def test_detail_404s_on_an_unknown_id(
        self, client, default_company, manager_headers
    ):
        response = client.get(
            "/api/reconciliation/periods/9999", headers=manager_headers
        )

        assert response.status_code == 404

    def test_another_companys_period_is_not_reachable(
        self, client, db_session, default_company, second_company, manager_headers
    ):
        row = declare(db_session, second_company, date(2026, 6, 1))

        response = client.get(
            f"/api/reconciliation/periods/{row.id}", headers=manager_headers
        )

        assert response.status_code == 404

    def test_a_cashier_is_refused(self, client, default_company, cashier_headers):
        response = client.get("/api/reconciliation/periods", headers=cashier_headers)

        assert response.status_code == 403
```

Use whatever the second-company fixture in `tests/conftest.py` is actually called (defined
around line 148) and rename the parameter to match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_reconciliation_endpoints.py::TestPeriodEndpoints -v`
Expected: FAIL — 404 on `/api/reconciliation/periods`, because the route does not exist.

- [ ] **Step 3: Write the implementation**

In `sellary-backend/api/reconciliation.py`, extend the imports:

```python
from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import (
    AuthContext,
    require_admin,
    require_manager_or_admin,
    require_module,
)
from schemas.reconciliation import (
    PeriodDetail,
    PeriodList,
    ReconciliationCreate,
    ReconciliationRead,
    ReconciliationState,
)
from services.period_report_service import PeriodReportService
```

Then add the two routes. Put them **above** the existing `POST ""` so the file reads
read-then-write, and note that neither collides with a path parameter — there is no
`GET /{id}` on this router.

```python
@router.get("/periods", response_model=PeriodList)
def list_periods(
    limit: int = Query(12, ge=1, le=60),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("reports", "manager")),
):
    # A report page, so a report module guard — the nav is module-keyed, and a
    # page reachable outside its module is either invisible or a 403.
    return PeriodReportService(db, auth.company_id).list(limit=limit, offset=offset)


@router.get("/periods/{reconciliation_id}", response_model=PeriodDetail)
def get_period(
    reconciliation_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("reports", "manager")),
):
    detail = PeriodReportService(db, auth.company_id).detail(reconciliation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Период не найден.")
    return detail
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_reconciliation_endpoints.py::TestPeriodEndpoints -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole backend suite and the compile gate**

Run: `pytest tests/integration tests/unit`
Expected: PASS.

Run: `python -m compileall api core models repositories schemas services main.py`
Expected: no errors. This is the CI gate.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/api/reconciliation.py sellary-backend/tests/integration/test_reconciliation_endpoints.py
git commit -m "feat(api): a сверка period is addressable and readable"
```

---

### Task 10: The API client and types

**Files:**
- Modify: `sellary-frontend/src/lib/types.ts`
- Modify: `sellary-frontend/src/lib/api.ts:556-564`

- [ ] **Step 1: Add the types**

Append to `sellary-frontend/src/lib/types.ts`. Money crosses the wire as a string, matching
every other money type in this file.

```ts
export interface PeriodRow {
  id: number;
  index: number;
  /** null on the oldest period: it covers everything before the first сверка. */
  start_day: string | null;
  end_day: string;
  note: string | null;
  purchased: string;
  sold: string;
}

export interface PeriodList {
  total: number;
  periods: PeriodRow[];
}

export interface LateArrivals {
  count: number;
  total: string;
}

export interface PeriodDetail extends PeriodRow {
  effective_from: string;
  declared_at: string;
  declared_by: string | null;
  receipts_count: number;
  sales_count: number;
  cost: string;
  profit: string;
  write_off_cost: string;
  profit_after_write_offs: string;
  /** Informational. `sold` is already net of these — never subtract twice. */
  returns_total: string;
  late_arrivals: LateArrivals;
  checker_report: unknown[] | null;
}
```

- [ ] **Step 2: Add the calls**

In `sellary-frontend/src/lib/api.ts`, extend the `reconciliationApi` object at line 556 and
add `PeriodDetail, PeriodList` to the existing type import from `@/lib/types`:

```ts
export const reconciliationApi = {
  get: () => api.get<ReconciliationState>('/reconciliation'),
  check: () => api.get<ConsistencyReport>('/reconciliation/check'),
  periods: (params?: { limit?: number; offset?: number }) =>
    api.get<PeriodList>('/reconciliation/periods', { params }),
  period: (id: number) => api.get<PeriodDetail>(`/reconciliation/periods/${id}`),
  create: (data: {
    effective_from: string;
    note?: string;
    acknowledge_violations?: boolean;
  }) => api.post<Reconciliation>('/reconciliation', data),
};
```

- [ ] **Step 3: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add sellary-frontend/src/lib/types.ts sellary-frontend/src/lib/api.ts
git commit -m "feat(api): reach the period reports from the client"
```

---

### Task 11: The «Периоды» page

**Files:**
- Create: `sellary-frontend/src/app/(protected)/periods/page.tsx`
- Modify: `sellary-frontend/src/lib/moduleNav.ts:68-75`
- Modify: `sellary-frontend/src/components/ReconciliationNotice.tsx:20-30`

- [ ] **Step 1: Write the page**

Create `sellary-frontend/src/app/(protected)/periods/page.tsx`. One route, one expanding
row — no second page, no second query key beyond the detail's own.

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { reconciliationApi } from '@/lib/api';
import { formatIsoDate, formatMoney } from '@/lib/utils';
import { CardSkeleton } from '@/components/skeletons';
import QueryError from '@/components/ui/QueryError';
import { ModuleGuard } from '@/components/ModuleGuard';
import type { PeriodDetail, PeriodList, PeriodRow } from '@/lib/types';

/** «01.06 — 30.06.2026», or «до 30.04.2026» when the period has no start. */
function periodLabel(row: Pick<PeriodRow, 'start_day' | 'end_day'>) {
  if (!row.start_day) return `до ${formatIsoDate(row.end_day)}`;
  return `${formatIsoDate(row.start_day)} — ${formatIsoDate(row.end_day)}`;
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-[var(--erp-divider)] bg-white p-3 dark:bg-gray-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums text-[var(--erp-text)] dark:text-white">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-[var(--erp-muted)]">{hint}</p>}
    </div>
  );
}

function Detail({ id }: { id: number }) {
  const detail = useQuery<PeriodDetail>({
    queryKey: ['reconciliation', 'period', id],
    queryFn: async () => (await reconciliationApi.period(id)).data,
  });

  if (detail.isLoading) return <CardSkeleton />;
  if (detail.isError) {
    return <QueryError what="период" onRetry={() => void detail.refetch()} />;
  }

  const data = detail.data!;

  return (
    <div className="space-y-3 border-t border-[var(--erp-divider)] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Закуплено"
          value={formatMoney(data.purchased)}
          hint={`${data.receipts_count} поставок`}
        />
        <Figure
          label="Продано"
          value={formatMoney(data.sold)}
          hint={`${data.sales_count} чеков, за вычетом возвратов`}
        />
        <Figure label="Себестоимость" value={formatMoney(data.cost)} />
        <Figure
          label="Прибыль"
          value={formatMoney(data.profit)}
          hint={`после списаний ${formatMoney(data.profit_after_write_offs)}`}
        />
        <Figure label="Списания" value={formatMoney(data.write_off_cost)} />
        <Figure
          label="Возвраты"
          value={formatMoney(data.returns_total)}
          hint="уже вычтены из «Продано»"
        />
      </div>

      {data.late_arrivals.count > 0 && (
        <div
          role="status"
          className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-3 text-[13px] leading-snug"
        >
          {data.late_arrivals.count} чека на {formatMoney(data.late_arrivals.total)} пришли
          с кассы после закрытия периода. Они посчитаны своей датой, поэтому цифры выше
          отличаются от тех, что были в день сверки.
        </div>
      )}

      {data.checker_report && data.checker_report.length > 0 && (
        <div className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-3 text-[13px] leading-snug">
          При сверке были зафиксированы расхождения — период закрыт с ними.
        </div>
      )}

      <p className="text-xs text-[var(--erp-muted)]">
        Сверка от {formatIsoDate(data.effective_from)}
        {data.declared_by ? `, провёл ${data.declared_by}` : ''}.
      </p>
    </div>
  );
}

function Periods() {
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery<PeriodList>({
    queryKey: ['reconciliation', 'periods'],
    queryFn: async () => (await reconciliationApi.periods()).data,
  });

  return (
    <div className="h-full space-y-4 overflow-y-auto mobile-no-overscroll p-4">
      <div>
        <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">
          Периоды
        </h2>
        <p className="mt-0.5 max-w-[70ch] text-sm text-[var(--erp-muted)]">
          Каждая сверка закрывает период. Здесь видно, сколько за этот период купили и
          сколько продали. Цифры считаются заново при каждом открытии, поэтому они всегда
          совпадают с остальными отчётами.
        </p>
      </div>

      {list.isLoading ? (
        <CardSkeleton />
      ) : list.isError ? (
        <QueryError what="периоды" onRetry={() => void list.refetch()} />
      ) : list.data!.periods.length === 0 ? (
        <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
          Сверок ещё не было. Периоды появятся после первой сверки — её проводят в
          Настройках.
        </div>
      ) : (
        <div className="space-y-2">
          {list.data!.periods.map((row) => (
            <div key={row.id} className="border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
              <button
                onClick={() => setOpenId(openId === row.id ? null : row.id)}
                aria-expanded={openId === row.id}
                className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 p-4 text-left hover:bg-[var(--erp-surface)]"
              >
                <span className="font-semibold text-[var(--erp-text)]">
                  {periodLabel(row)}
                </span>
                <span className="text-xs text-[var(--erp-muted)]">Сверка №{row.index}</span>
                <span className="ml-auto text-sm tabular-nums">
                  Куплено{' '}
                  <b className="font-semibold">{formatMoney(row.purchased)}</b>
                </span>
                <span className="text-sm tabular-nums">
                  Продано <b className="font-semibold">{formatMoney(row.sold)}</b>
                </span>
              </button>
              {openId === row.id && <Detail id={row.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PeriodsPage() {
  return (
    <ModuleGuard module="reports">
      <Periods />
    </ModuleGuard>
  );
}
```

- [ ] **Step 2: Add the nav entry**

In `sellary-frontend/src/lib/moduleNav.ts`, extend the `reports` group (line 68-75):

```ts
  {
    key: 'reports',
    label: 'Отчеты',
    tagline: 'Дашборд и аналитика продаж',
    pages: [
      { label: 'Дашборд', href: '/dashboard' },
      { label: 'Аналитика', href: '/reports' },
      { label: 'Периоды', href: '/periods' },
    ],
  },
```

- [ ] **Step 3: Point the notice at the page**

In `sellary-frontend/src/components/ReconciliationNotice.tsx`, the banner promises «их можно
смотреть» and until now pointed nowhere. Add the import and the link:

```tsx
import Link from 'next/link';
```

```tsx
      <p className="text-[13px] leading-snug text-[var(--erp-text)]">
        Сверка от {formatIsoDate(reconciledFrom)}. Данные до этой даты закрыты: их
        можно смотреть, но не изменять.{' '}
        <Link href="/periods" className="font-medium text-[var(--erp-accent)] hover:underline">
          Отчёты по закрытым периодам
        </Link>
        .
      </p>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Verify by hand**

Start the backend and frontend. On a company with at least two сверки, open `/periods`:

- the newest period is on top, with a start and an end date;
- the oldest reads «до <date>» with no start;
- opening a row shows six figures, and «Продано» carries the hint «за вычетом возвратов»;
- on a company with no сверка, the empty state renders instead of a spinner;
- `/reports` and `/purchase-report` show the notice with a working link to `/periods`.

- [ ] **Step 6: Commit**

```bash
git add "sellary-frontend/src/app/(protected)/periods/page.tsx" sellary-frontend/src/lib/moduleNav.ts sellary-frontend/src/components/ReconciliationNotice.tsx
git commit -m "feat(reports): a page for what each closed period bought and sold"
```

---

### Task 12: Document it

**Why:** `CLAUDE.md` and `AGENTS.md` carry the reasoning behind every money rule in this
codebase, and the two must stay consistent. A derived-not-stored decision that is not
written down is one refactor away from becoming a column.

**Files:**
- Modify: `CLAUDE.md` — the «Сверка (the reconciliation cut-off)» section
- Modify: `AGENTS.md` — the same section

- [ ] **Step 1: Add the paragraph to both files**

Append to the «Сверка» section in `CLAUDE.md`, then mirror it into `AGENTS.md`:

```markdown
A сверка's **period** — from the previous cut-off to the day before this one — is
derived, never stored. `services/reconciliation.py` holds the one predicate
(`periods`, `period`) beside `open_from`, and `services/period_report_service.py`
composes the existing profit and purchase reports over that window. Nothing is
written to `company_reconciliations`: a settled total with no independent source
is the same shape as `stock_quantity` drifting from its layers, and the freeze
binds the application rather than the database — the repair scripts write behind
it, so a derived report shows the repaired truth while a frozen column would
disagree with every other screen forever. The figure can move, and that residual
is named: `late_arrivals` on the period report counts receipts dated inside it
whose tenders were written after the freeze.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: why a period's figures are derived and not stored"
```

**PR 2 is complete.**

---

## Definition of done

- [ ] `pytest tests/integration tests/unit` passes from `sellary-backend/`
- [ ] `python -m compileall api core models repositories schemas services main.py` is clean
- [ ] `npx vitest run` passes from `sellary-frontend/`
- [ ] `npm run build` and `npm run lint` are clean
- [ ] No new file under `alembic/versions/` — this plan adds no migration
- [ ] `git grep -n "total_sold\|period_total\|frozen_revenue" sellary-backend` returns
      nothing: no figure was stored
