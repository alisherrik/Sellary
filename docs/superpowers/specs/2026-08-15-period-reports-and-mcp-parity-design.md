# Периоды сверки и полнота MCP

Date: 2026-08-15
Status: approved, ready for planning

## The problem

Two complaints from the shop owner, one root cause.

1. **He cannot see what he bought against what he sold.** «Аналитика» (`/reports`) shows
   sold, «Отчёт по закупкам» (`/purchase-report`) shows bought, they sit in different nav
   groups, and neither can be pointed at a period. Worse: after a сверка both pages
   silently hide the settled history, so the old data looks deleted.
2. **The MCP connector is a reporting surface, not a parity surface.** 17 tools against
   119 endpoints. Three of the nine modules — `sales`, `customers`, `shop` — have zero
   tools. The agent can say how much was sold but cannot name a receipt, can say where
   money sits but not how it got there, and cannot read back the purchase order it just
   created.

The root cause of (1) is not missing data. Every figure already exists and every service
already accepts explicit bounds. What is missing is a window and a view.

## Why the old data disappears (the bug)

`period_range` (`services/company_time.py:51`) fills a **missing** start with
`open_from()` — the сверка cut-off — and deliberately never truncates an explicit start.
That rule is correct and stays.

But `/reports` and `/purchase-report` only ever send `days`
(`reports/page.tsx:23`, `useQueries.ts:366,380,394`). Every request from those pages is
therefore a defaulted range, so after a сверка «за 90 дней» quietly means «с даты
сверки». `ReconciliationNotice` promises «их можно смотреть» and through those two pages
you literally cannot.

`purchaseReportApi.summary` already **types** `start_date`/`end_date` (`api.ts:453`) and
never sends them. `/sales` proves the rule works: it has date inputs, sends explicit
bounds, and shows settled history correctly.

**Fix: the frontend resolves the preset to concrete dates and sends them.** No backend
change. This ships first, as its own PR.

## Decision: derive, never snapshot

A period's figures are **recomputed from the existing services on every read**. They are
not frozen into `company_reconciliations`.

Why:

- A stored total is a derived money figure with no independent source — structurally the
  same mistake as `stock_quantity` drifting from its FIFO layers, and as migration
  `f3a4b5c6d7e8`, which verified its own arithmetic and was still wrong.
- `ConsistencyService` exists to recompute every derived figure from an independent
  source. A snapshot column earns a check that would report drift by design on every late
  arrival — and `ReconciliationService.create` refuses to freeze over drift
  (`reconciliation_service.py:59`). We would have built a check that guarantees the next
  сверка is blocked.
- The freeze binds the application, not the database. The maintenance scripts
  (`reconcile_ledger_drift.py`, `repair_purchase_15.py`) write behind it. A derived report
  shows the repaired truth; a snapshot would show the pre-repair number forever and
  disagree with every other screen.
- There is no re-declare path, so a wrong snapshot would be permanent.

What **is** frozen is context, not totals: `checker_report` (already written at declare
time, never read back) and the author. Both already exist as columns.

The cost of deriving is that the number can move. That residual is **named, not hidden** —
the same move `CashShiftService.compute_totals` makes with `late_arrivals`.

## Scope

In:

- Turnover figures per period: закуплено, продано, себестоимость, прибыль, списания,
  возвраты.
- 19 read-only MCP tools.
- The defaulted-range bug fix.

Out (explicitly, for now):

- Money movement per period, top products/suppliers per period, debt change per period.
  The period endpoint is shaped so they can be added later without breaking callers.
- Any new MCP write. `purchase_preview` / `purchase_commit` stay the only writes.
- Editing or deleting a сверка. Multi-currency (not modelled anywhere in the backend).

---

## Part 1 — Периоды

### 1.1 The period predicate

`services/reconciliation.py` already carries the file-level rule *"One predicate, one
floor… two writers of one rule is how the sales page and the reports page come to
disagree"*. The period boundary belongs in that file, beside `open_from`.

```python
@dataclass
class Period:
    id: int                    # the Reconciliation row that closed it
    index: int                 # 1-based, oldest first — «Сверка №3»
    start_day: date | None     # previous.effective_from; None for the oldest period
    end_day: date              # effective_from - 1 day, the last settled day
    effective_from: date
    note: str | None
    created_at: datetime
    created_by_user_id: int | None


def periods(db, company_id) -> list[Period]
def period(db, company_id, reconciliation_id) -> Period | None
```

`periods` is not paged. `index` counts from the oldest so «Сверка №1» keeps its number as
new ones are declared, and that cannot be computed from a page. Paging happens above it.

Rules:

- Newest first, ordered by `effective_from DESC, id DESC` — reuse
  `ReconciliationService._ordered()`.
- `start_day is None` for the oldest сверка: the period covers all history before it. It
  is rendered «до 30.04.2026», not with a fabricated start.
- `index` is assigned oldest-first so «Сверка №1» is stable as new ones are declared. It
  is computed from the full ordered set, not from the page.
- The currently **open** period (after the latest сверка, still running) is **not** in this
  list. It is not a closed period, and `/reports` already shows it.

### 1.2 Query bounds

```
start = local_day_bounds(tz, start_day)[0]   or None
end   = local_day_bounds(tz, end_day)[1]     # 23:59:59.999999 local
```

`start_day is None` means an unbounded start; the services take `datetime.min` on the
company clock rather than a special code path.

**Boundary note.** Sales filter `created_at <= end` (`report_service.py:161,222`) and
purchases filter `created_at < end` (`purchase_report_service.py:91`). Because `end` is
always `time.max`, both sides include the whole final day. Do **not** "fix" the operators
as part of this work — the inconsistency is pre-existing, harmless under this bound, and
changing it touches every report.

### 1.3 Endpoints

Both live in `api/reconciliation.py` behind `require_module("reports", "manager")`.

`require_manager_or_admin` — the existing guard on `GET /api/reconciliation` — was
considered and rejected. The nav is module-keyed (`moduleNav.ts`), so a page reachable
without the `reports` module would either be invisible to someone allowed to read it, or
visible to someone who gets a 403. `manager` carries the seniority the act deserves.

The consequence: a `reports:manager` without `purchasing` sees total purchase spend. That
is accepted — `/reports` already shows Прибыль, from which cost is derivable, so the
reports module is already the place where cost figures live.

**`GET /api/reconciliation/periods?limit=12&offset=0`**

```json
{
  "total": 7,
  "periods": [
    {
      "id": 12, "index": 3,
      "start_day": "2026-06-01", "end_day": "2026-06-30",
      "note": "Июньская сверка",
      "purchased": "12450.00",
      "sold": "18900.00"
    }
  ]
}
```

`purchased` = `PurchaseReportService.summary(start, end).total_spend`.
`sold` = `ReportService.get_profit_report(start, end).revenue` (already net of refunds).

Two aggregate reports per row, so a page is a few dozen indexed aggregates. That is why the
default page is 12 — a year of monthly сверки — and `limit` is bounded to 60. If it ever
becomes slow, the fix is a narrower spend query, not a stored column.

**`GET /api/reconciliation/periods/{id}`**

```json
{
  "id": 12, "index": 3,
  "start_day": "2026-06-01", "end_day": "2026-06-30",
  "effective_from": "2026-07-01",
  "note": "Июньская сверка",
  "declared_at": "2026-07-01T09:14:00Z",
  "declared_by": "Алишер",
  "purchased": "12450.00",
  "receipts_count": 34,
  "sold": "18900.00",
  "sales_count": 512,
  "cost": "11200.00",
  "profit": "7700.00",
  "write_off_cost": "340.00",
  "profit_after_write_offs": "7360.00",
  "returns_total": "220.00",
  "late_arrivals": { "count": 2, "total": "180.00" },
  "checker_report": null
}
```

Sources — all existing, none new:

| Field | Source |
|---|---|
| `purchased`, `receipts_count` | `PurchaseReportService.summary(start, end)` |
| `sold`, `sales_count`, `cost`, `profit`, `write_off_cost`, `profit_after_write_offs` | `ReportService.get_profit_report(start, end)` |
| `returns_total` | `SUM(sale_returns.total_refund_amount)` over the window, company-scoped |
| `declared_by` | `users.full_name` via `created_by_user_id`, `null` when unset |
| `checker_report` | the existing JSON column, surfaced for the first time |

`sold` is **already net of returns**. `returns_total` is informational and the UI must
label it so; it is never subtracted again.

### 1.4 Late arrivals

An offline sale that syncs after the cut-off is accepted at its own timestamp by design,
so a settled period's `sold` can grow after settlement. The period report names it:

> ⚠ 2 чека на 180.00 пришли после закрытия периода

Definition: sales whose `created_at` falls inside the period **and** whose earliest
`sale_payments.created_at` is later than the reconciliation's `created_at`.

`MIN(sale_payments.created_at)` is the arrival proxy `ConsistencyService` already uses
(`consistency_service.py:324`). Its known blind spot is a synced sale with no tender rows;
that is the checker's problem, not this feature's, and we do not invent a second proxy.

Detail view only, never in the list. Absent (`count: 0`) it is not rendered.

### 1.5 Frontend

New page `/periods`, «Периоды», in the reports nav group (`moduleNav.ts`), visible to
manager and admin.

```
Периоды
──────────────────────────────
▸ 01.06 — 30.06.2026   Сверка №3
    Куплено  12 450   Продано  18 900
▸ 01.05 — 31.05.2026   Сверка №2
    Куплено   9 100   Продано  15 300
▸ до 30.04.2026        Сверка №1
    Куплено   ...      Продано  ...
```

A row expands in place into the detail block; no second route, no second query key beyond
`['reconciliation', 'period', id]`. `checker_report` renders as a warning block: «При
сверке были зафиксированы расхождения» plus the findings — this is a recorded fact about
that period, not an error.

Empty state, when the company has never reconciled: «Сверок ещё не было. Периоды появятся
после первой сверки.» with a link to Настройки → Сверка.

`ReconciliationNotice` gains a link to `/periods`, so its «их можно смотреть» promise
finally points somewhere.

### 1.6 The bug fix (separate PR, ships first)

`/reports` and `/purchase-report` resolve their preset to an explicit **`start_date` only**
and send it. `useDailySales`, `useProfit`, `useTopProducts` and the four
`purchaseReportApi` calls pass it through — the API client already types it.

`end_date` is deliberately left empty. `period_range` then fills it from
`local_day_bounds()` on the **company** clock, which the browser does not know
(`timezone` appears nowhere in `sellary-frontend/src`). Only the start is computed in the
browser, where the worst error is ±1 day on a 90-day window — the same trade-off
`sales/page.tsx:353` already documents and accepts.

The floor itself is not touched. It is deliberate, and
`tests/unit/test_reconciliation_period.py::test_a_defaulted_range_starts_at_the_cut_off`
pins it: with no explicit start, the default view after a сверка shows the open period.
That stays true for the dashboard and for any caller that sends nothing.

Regression test: with a сверка declared at today−10 days, a 90-day request from those
pages returns data from before the cut-off.

---

## Part 2 — MCP parity

### 2.1 A new scope, not nine

Today `SCOPES = [sellary:reports, sellary:purchasing]` (`mcp_server/__init__.py:11`) and
every read tool asks for `SCOPE_REPORTS` regardless of which module it guards. The real
gate is `require_module`, which runs on every call — *"A scope is necessary but never
sufficient"* (`context.py:174`).

Per-module scopes were considered and rejected: nine scopes duplicate the module registry,
and the module check already enforces it.

But hanging row-level reads on the existing scope would **silently widen every token
already issued**. A user who consented to «Просмотр отчётов» did not consent to an agent
reading named customers' debts and individual receipts.

So: **one new scope, `sellary:records`**, for row-level reads. Aggregates stay on
`sellary:reports`.

- `mcp_server/__init__.py` — add `SCOPE_RECORDS = "sellary:records"` to `SCOPES`.
- `oauth/templates.py:134` — add the Russian consent label: «Просмотр записей: чеки,
  долги клиентов, движения денег и склада».
- `provider.py:56` already sets `default_scopes=list(SCOPES)`, so new registrations pick it
  up. Existing tokens do not carry it and get the correct existing message: «Приложению не
  выдано это разрешение. Переподключите его к Sellary».

### 2.2 The 19 tools

17 exist today; these bring the surface to 36.

All read-only. All follow the existing shape: `mcp_session()` → `require_scope` →
`require_module` → call the service → serialise with `mcp_server/serialization.py`. A tool
is the MCP equivalent of a router and holds no business logic.

| Tool | Module | Scope | Backing call |
|---|---|---|---|
| `get_sale(sale_id)` | sales | records | `SaleService.get_by_id` |
| `list_sales(...)` | sales | records | `SaleService.get_all` |
| `list_sale_returns(sale_id)` | sales | records | `SaleReturnService.get_returns_for_sale` |
| `list_customers(query, limit)` | customers | records | `CustomerRepository.get_all` |
| `get_customer_debt(customer_id)` | customers | records | `CustomerLedgerService.get_customer_balance` + `.get_customer_ledger` |
| `get_money_movements(...)` | finance | records | `MoneyService.history` |
| `get_stock_movements(...)` | inventory | records | `InventoryService.get_logs` |
| `list_write_offs(...)` | inventory | records | `StockWriteOffService.list` |
| `get_write_off_summary(period)` | inventory | reports | `StockWriteOffService.summary` |
| `get_inventory_valuation()` | inventory | reports | `InventoryService.get_inventory_value` |
| `list_categories()` | inventory | reports | `CategoryRepository` (there is no category service) |
| `list_products(query=None, ...)` | inventory | reports | `ProductService.get_all` |
| `get_purchase_order(po_id)` | purchasing | records | `PurchaseOrderService.get_by_id` |
| `list_purchase_orders(...)` | purchasing | records | `PurchaseOrderService.get_all` |
| `list_shop_orders(...)` | shop | records | `OrderService.list_orders_for_company` |
| `get_shift(shift_id=None)` | register | records | `CashShiftService.get_current` / `.totals_for` |
| `run_consistency_check()` | — admin role | records | `ConsistencyService.run` |
| `list_periods()` / `get_period_report(id)` | — manager/admin | reports | Part 1's service functions |

Notes:

- `search_products` keeps its required `query`. `list_products` is the new tool that
  browses without one — do not loosen the existing tool's signature and change what an
  already-connected agent's call means.
- `run_consistency_check`, `list_periods` and `get_period_report` are not module-gated;
  they mirror their REST guards (`require_admin` / `require_manager_or_admin`) against
  `auth.role`. Reading the checker is the useful half of сверка; **declaring** one stays
  out.
- Every tool docstring is Russian, matching the existing 17.
- Period arguments use the existing `mcp_server/periods.py` vocabulary (`today`,
  `this_month`, …), never hand-computed dates.
- `get_shift` reads a single shift by id, or the open one when no id is given. The existing
  `list_shifts` tool stays as it is. Note that `api/cash_shifts.py:110` builds its list
  query inside the router; the tool must not copy that — it queries `CashShiftModel`
  directly and formats with `CashShiftService.totals_for`, the same as the existing tool.

### 2.3 Stays out, deliberately

Ten write capabilities are excluded. Each either moves money outward, is a physical count
that needs a human author, or edits the agent's own authority.

| Excluded | Why |
|---|---|
| Ringing a sale (`POST /api/sales`) | Invents turnover, consumes FIFO layers, invents a debt against a named person, and holds the cashier on duty to takings they never rang |
| Refunds and returns | Moves cash out to a person and rewrites a row that may sit in a settled period |
| Voiding a sale or purchase | Erases a recorded event and releases FIFO allocations; manager-gated and reconciliation-guarded for that reason |
| Opening / closing a shift | `opening_cash` and `counted_cash` are what a person physically counted; close writes the difference as a real adjustment against a named cashier |
| Delta stock adjustment (`POST /api/inventory/adjust`) | A delta applied to whatever the server currently holds is the exact failure that produced 146 bad production adjustments |
| Stocktake (`POST /api/inventory/stocktake`) | Absolute and safer, but still a count. A count is a document with a human author |
| Balance correction («Сверить») on a money account | The one write that makes a discrepancy disappear without explaining it. An agent that can both report drift and erase it is not a check on the books |
| Declaring a сверка | Irreversible in effect, spans stock and cash, and `acknowledge_violations` lets the caller freeze over known drift |
| Staff, memberships, module grants, password reset | Privilege escalation; the connector is itself gated on a module grant. Credentials never belong on an agent channel |
| Listing / revoking MCP agents | The connector's own kill switch. It must live only where a human holds it |

Purchases stay the single write, and keep their two-phase `preview` → signed
`draft_token` → `commit` shape guarded by `idempotency_keys`.

---

## Testing

Backend (`pytest tests/integration tests/unit` from `sellary-backend/`, `session.flush()`
not `commit()`):

- `periods()` with 0, 1 and 3 сверка rows; oldest period has `start_day is None`; `index`
  is oldest-first and stable across pages.
- `end_day == effective_from - 1 day`; a sale on `end_day` at 23:59 counts, a sale on
  `effective_from` at 00:00 does not.
- Period totals equal `/api/reports/profit` and `/api/reports/purchases` called with the
  same explicit bounds — the derived-not-stored guarantee.
- A sale synced after the сверка and dated inside the period appears in `late_arrivals` and
  in `sold`.
- `checker_report` written by an `acknowledge_violations` сверка is returned by the detail
  endpoint.
- Both endpoints reject a plain member (403) and reject another company's reconciliation id
  (404).
- Regression: with a сверка 10 days back, a 90-day request carrying explicit dates returns
  pre-cut-off data.

MCP:

- Each tool rejects a token lacking its scope, and rejects a member lacking its module.
- Every tool is refused when the `ai` module is switched off, including with a valid token.
- `get_sale` on another company's sale id returns not-found, never the row.
- Tool count and names are asserted, so a tool cannot be added without a deliberate test
  change.

Frontend (`npx vitest run`):

- The preset resolver produces the expected `start_date` / `end_date` on a non-UTC company
  timezone.
- `/periods` renders «до 30.04.2026» for a `null` start, and hides the late-arrivals line
  at `count: 0`.

CI gate stays `python -m compileall api core models repositories schemas services main.py`.

## Delivery order

1. **PR 1 — bug fix.** Frontend sends explicit dates from `/reports` and
   `/purchase-report`. Independently valuable: it un-hides the settled history today.
2. **PR 2 — periods.** `periods()` / `period()` in `services/reconciliation.py`, the two
   endpoints, the `/periods` page.
3. **PR 3 — MCP.** `sellary:records` scope + consent label, then the 19 tools grouped by
   module across `tools_sales.py`, `tools_customers.py`, `tools_finance.py`,
   `tools_inventory.py`, `tools_purchasing.py`, `tools_admin.py`. `tools_reports.py` is
   already 300 lines; do not grow it further.

No migration in any of the three.

## Plans

- `docs/superpowers/plans/2026-08-15-period-reports.md` — PR 1 and PR 2
- `docs/superpowers/plans/2026-08-15-mcp-read-parity.md` — PR 3
