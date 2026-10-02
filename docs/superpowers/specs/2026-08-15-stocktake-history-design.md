# Инвентаризация — a history page for counted stock

Date: 2026-08-15
Status: approved, ready for planning

## The problem

Counting stock writes an `inventory_logs` row, and there is nowhere to read those
rows back. The only surface today is `StockHistorySheet`
(`sellary-frontend/src/components/inventory/StockHistorySheet.tsx`), a slide-over
opened from one product on the products page, showing that product's **whole**
movement history — sales, receipts, write-offs and counts mixed together, with a
single receipt-number filter.

So the questions an owner actually asks have no answer:

- Which products get corrected over and over? (the error or theft signal)
- Who counted what, and when?
- How much did the counts cost us in total this month?

`POST /api/inventory/stocktake` is write-only. `GET /api/inventory/logs` exists
but takes only `product_id` and `sale_id` — no way to ask for counts alone.

## Decision: one server flag, everything else in the browser

The page filters, searches and groups client-side. The server's only new job is
to return **counted-stock rows and nothing else**.

That split is deliberate, and the boundary is where it is for a measured reason.
Pure client-side filtering was the first instinct and it does not survive the
row counts: every sale line writes an `inventory_log` row, so a shop ringing
1052 receipts a month generates thousands of movement rows, while counts number
in the low hundreds over the app's whole life. Filtering those out in the
browser means downloading the entire movement history to find a handful of rows.
One `in_()` clause on the existing query avoids that, and costs three lines.

Everything past that point — date range, reason, who, direction, search,
group-by — is genuinely cheap on a few hundred rows and needs no endpoint work.

## What counts as «инвентаризация»

`StocktakeReason` (`schemas/inventory_log.py:33`) already defines it, and
`apply_stocktake` writes `reason.value` straight into
`inventory_logs.reference_type`. So the four values are the definition:
`stocktake`, `surplus`, `shortage`, `other`.

`manual_adjust` is included as a fifth. It is the removed edit-form quantity box
— the one that put 146 corrections into production, many zeroing a product and
none saying why (see CLAUDE.md, «Counting stock»). It is a dead channel, but
those rows are real historical corrections to counted stock, and an audit page
that silently omits the known-bad ones is worse than one that shows them.
`STOCK_MOVEMENT_LABELS` already renders it «Корректировка», distinct from
«Инвентаризация», so the two channels never read as one row type.

## Scope

In:

- `stocktake_only` flag on `GET /api/inventory/logs`.
- New page `/stocktakes`, two views (flat list, grouped by product), four
  filters, product search.

Out:

- Any server-side date/reason/user filter. Added later only if the row cap below
  actually bites.
- Any new write. The page reads; counting stays `POST /api/inventory/stocktake`
  from the products page.
- Touching `StockHistorySheet` at all. It keeps its current job (one product's
  full movement history, from the products page) and this page does not use it.

## Backend

| File | Change |
|---|---|
| `schemas/inventory_log.py` | Add `STOCKTAKE_REFERENCE_TYPES` beside `StocktakeReason`: the four enum values plus `"manual_adjust"`. Derive it from the enum — `tuple(r.value for r in StocktakeReason) + ("manual_adjust",)` — so a new reason cannot be added to the enum and forgotten here. |
| `repositories/inventory_repository.py:16` | `get_logs` gains `stocktake_only: bool = False`; when set, `query.filter(InventoryLog.reference_type.in_(STOCKTAKE_REFERENCE_TYPES))`. Mirrors the existing `sale_id` clause exactly. |
| `services/inventory_service.py:161` | Pass it through. No logic. |
| `api/inventory.py:132` | `stocktake_only: bool = Query(False)`; raise `limit`'s ceiling from `le=200` to `le=1000`. |

The row shape needs nothing: `InventoryLog` (`schemas/inventory_log.py:8`)
already carries `product_name`, `user_name`, `quantity_change`, `value_change`,
`previous_quantity`, `new_quantity`, `reason`, `reference_type`, `created_at`.

## Frontend

New page `sellary-frontend/src/app/(protected)/stocktakes/page.tsx`, listed as
«Инвентаризация» in the `inventory` nav group (`lib/moduleNav.ts`), behind
`ModuleGuard module="inventory"`.

**Loading.** One request: `stocktake_only=true, limit=1000`, newest-first. No
page-walking — 1000 is the endpoint's new ceiling and one page of it is the whole
dataset for any realistic shop. When exactly 1000 rows come back the page says
«Показаны последние 1000 записей» rather than truncating in silence. A full count
of a 485-product catalogue is 485 rows, so the ceiling is roughly two years of
monthly counts; if it ever bites, the fix is a server date filter, not a bigger
number.

**Two views**, as tabs — the switch pattern `/purchase-report` already uses:

- «Список» — sana · товар · причина · было→стало · ±кол-во · ±сумма · кто
- «По товарам» — товар · счётов · ±кол-во · ±сумма · последний, sorted by count
  descending so the most-corrected product is first. A row expands in place to
  that product's own count rows, taken from the already-loaded array.

Expanding in place rather than opening `StockHistorySheet` is deliberate. That
sheet takes a full `Product` (it prints `stock_quantity` and `uom` in its header),
and a log row carries only `product_id` and `product_name` — reusing it would
mean a second fetch per click to recover fields the page does not otherwise need.
It also shows *every* movement type, which is the opposite of this page's point.
The rows to expand are already in memory.

**Four filters**, in `FilterMenu` (`components/filters/FilterMenu.tsx`, the
funnel-with-badge panel `/sales` uses):

1. Date range — two date inputs, compared on the row's local calendar day.
2. Reason — the five `reference_type` values, labelled from
   `STOCK_MOVEMENT_LABELS` (`lib/stockMovements.ts`), which already has all
   five.
3. Who — the distinct `user_name` values present in the loaded rows.
4. Direction — излишек (`quantity_change > 0`) / недостача (`< 0`) / все.

**Search** — product name, debounced via `hooks/useDebounce.ts`. The
`InventoryLog` TS type (`lib/types.ts:828`) already matches the response, money
and quantities as strings; no new type is needed.

Both views and every filter read the same loaded array, so the summary line
(«N счётов, ±X ед., ±Y сум.») always describes exactly what is on screen.

## Testing

Backend (`pytest tests/integration tests/unit` from `sellary-backend/`,
`session.flush()` not `commit()`):

- `stocktake_only=true` returns a `stocktake` row and excludes a `sale` row.
- It includes all five reference types and excludes `po_receive` and `write_off`
  — the boundary is the list, not a guess.
- `STOCKTAKE_REFERENCE_TYPES` contains every `StocktakeReason` value, so adding
  a reason to the enum without updating the tuple fails the suite.
- `stocktake_only=false` (the default) is unchanged: an existing caller still
  gets sales.
- `limit=1000` is accepted; `limit=1001` is a 422.
- The flag composes with `product_id`.

Frontend (`npx vitest run` from `sellary-frontend/`):

- The grouped view sums `quantity_change` per product and orders by count
  descending.
- The direction filter splits on the sign of `quantity_change`. There are no
  zero-change rows to worry about: `apply_stocktake` writes no log when the
  counted figure matches, because confirming a correct quantity is not a
  movement.
- The date filter is inclusive at both ends on the row's own local day.

The filter/group/search rules live in `lib/stocktakeHistory.ts` as pure functions
precisely so these are unit tests over an array, with no rendering. The row-cap
notice is one boolean over `rows.length` and is covered by the manual pass rather
than a page render test.

CI gate stays `python -m compileall api core models repositories schemas services main.py`.
