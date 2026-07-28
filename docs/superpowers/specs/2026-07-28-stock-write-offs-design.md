# Stock write-offs and supplier returns — Design

Date: 2026-07-28
Status: approved (owner approved approach A and the no-money rule for returns)
Scope: taking spoiled, broken or defective goods off the shelf as a document —
either thrown away or handed back to the supplier.

## The case

> Zakupka qilingan productlar vaqt utganidan keyin ahvoli yomonlashadi va uni
> qandaydirlari qaytariladi yana qaysidiri shunchaki tashlab yubvoriladi.

Goods bought and received go bad on the shelf. Some go back to the supplier;
the rest are thrown out. Today neither is representable as a fact — the only
tool is `POST /api/inventory/adjust`, a single-product quantity change whose
`reason` is a free-text `String(255)`.

That has three consequences:

- **No report.** "How much did we lose to spoilage this month?" has no answer,
  because the reason is prose, not a code, and cannot be grouped.
- **Loss and return look identical.** Both are a negative adjustment. The books
  cannot tell "we ate this" from "the supplier took it back".
- **No document.** Ten spoiled items is ten separate acts with no shared date,
  reason, or approval.

## What already works

`services/inventory_ledger_service.py` is sound and stays untouched.
`consume_fifo` eats FIFO layers at their real cost, writes the `inventory_logs`
row itself (including `value_change`, the money the stock was worth), and
refuses to drive stock negative unless the caller passes `allow_oversell`. A
write-off is exactly a FIFO consumption with a different consumer — so it is
a new caller of the existing ledger, not a new ledger.

That matters more than it looks. `stock_quantity` once drifted from its FIFO
layers because a second channel wrote it. There will not be a second channel
here.

## Decisions taken before design

**Expiry dates are out of scope.** No lot/batch tracking, no FEFO, no
"expires in 7 days" alerts. `expired` exists only as a reason code the user
picks by hand.

**A supplier return moves no money.** `suppliers` has no balance and
`purchase_orders` has no `paid_amount`; there is no supplier debt to reduce and
no ledger to post against. Building one is a larger feature than this one. So a
return records that the goods left and who took them, and stops there. The
owner sees it in the write-off report as "returned" rather than "disposed", and
the loss figure separates the two.

This is a deliberate limitation, not an oversight. If the supplier later refunds
cash, that is an ordinary money movement the owner records in Finance.

## Model

Two new tables, header and lines — the shape `purchase_orders` and `sales`
already use.

### `stock_write_offs`

| Column | Type | Note |
|---|---|---|
| `id` | Integer PK | |
| `company_id` | FK companies, indexed | tenant scope |
| `disposition` | String(24), not null | `disposed` \| `returned_to_supplier` |
| `reason_code` | String(24), not null | see list below |
| `supplier_id` | FK suppliers, nullable | required iff `returned_to_supplier` |
| `notes` | Text | |
| `total_cost` | Numeric(16,4), not null | sum of line costs, frozen at creation |
| `created_by_user_id` | FK users, not null | |
| `created_at` | DateTime(tz), server default | indexed — reports filter on it |

### `stock_write_off_items`

| Column | Type | Note |
|---|---|---|
| `id` | Integer PK | |
| `write_off_id` | FK stock_write_offs, cascade delete | |
| `product_id` | FK products | |
| `product_unit_id` | FK product_units, nullable | null = base unit |
| `unit_quantity` | Numeric(12,3) | what the user typed |
| `quantity` | Numeric(10,3) | **base units** — what hits stock |
| `unit_cost` | Numeric(16,4) | `line_cost / quantity`, for display |
| `line_cost` | Numeric(16,4) | real FIFO cost consumed |

No `company_id` on the lines: tenant scope is inherited through the parent, the
same as `sale_items` and `purchase_order_items`.

### Why these types

`disposition` and `reason_code` are `String`, not a Postgres enum. Money
accounts were bitten twice by native enums that SQLite silently tolerates in
tests and Postgres rejects in production. The allowed values live in Python
constants next to the model and are validated in the schema layer.

`total_cost` and `line_cost` are **frozen facts**, written once at creation from
what `consume_fifo` actually consumed. They are never recomputed from today's
`cost_price`, for the same reason a closed shift's totals are frozen: the FIFO
layers that fed this document may be gone tomorrow.

`quantity` is in base units. `sale_items` already carries base quantity with the
chosen unit alongside it; a write-off follows the same rule so `product_units`
work identically everywhere.

### Reason codes

`spoiled` (порча) · `damaged` (бой/повреждение) · `defective` (заводской брак) ·
`expired` (просрочка) · `lost` (утеряно/кража) · `shortage` (недостача по
инвентаризации) · `internal_use` (внутреннее использование).

Reason and disposition are two independent axes, deliberately. That is what lets
the report say "порча 400 сомони, из них 250 вернули поставщику" — a single
flat list of reasons could not.

### No void

Version one has no edit and no delete. A wrong act is corrected with a positive
`POST /api/inventory/adjust`. We are not adding `voided_at` / `void_reason`
columns that nothing writes; when a real reversal requirement appears it can use
the existing `reversal_operations` table the way sales do.

## Backend

### `services/stock_write_off_service.py`

`create(payload, user_id) -> StockWriteOff` is the only place the rules live:

1. Validate: at least one line; every `quantity > 0`; `reason_code` in the
   allowed set; `returned_to_supplier` requires `supplier_id` and it must belong
   to the company; `disposed` forbids `supplier_id`.
2. Resolve each line's unit to base quantity (`unit_quantity * factor`).
3. Lock each product with `ProductRepository.get_by_id_for_update`.
4. Per line, call
   `ledger.consume_fifo(product, quantity, consumer_type="write_off",
   consumer_id=<write_off id>, sale_item_id=None, user_id=..., reason=reason_code,
   reference_type="write_off", reference_id=<write_off id>)`.
   **`allow_oversell` is not passed** — a write-off of stock that is not there is
   a data error, and is rejected exactly as an online sale would be.
5. `line_cost = consumption.value`; `total_cost = sum(line_cost)`.

Duplicate `product_id` lines are merged before consumption, so one product is
locked and consumed once per document.

`list_write_offs(...)` and `get_write_off(id)` for reads; `summary(period)` for
the report.

### `api/stock_write_offs.py` — prefix `/write-offs`

| Endpoint | Guard | Note |
|---|---|---|
| `POST /api/write-offs` | `require_module("inventory", "manager")` | **`Idempotency-Key` required**, same wrapper as `/inventory/adjust` |
| `GET /api/write-offs` | `require_module("inventory")` | filters: date range, `disposition`, `reason_code`, `supplier_id`; paginated |
| `GET /api/write-offs/{id}` | `require_module("inventory")` | with lines |
| `GET /api/write-offs/summary` | `require_module("inventory")` | grouped by reason and disposition |

Creating stock loss is a manager-level act, like adjusting stock. Reading stays
at plain `inventory` level — including the summary, since the per-document cost
is already visible in the list and hiding only the total would protect nothing.
The profit report keeps its own `reports` guard.

Registered in `main.py` alongside the other routers.

### Migration

One new Alembic revision creating both tables. The database has **two heads** —
run `alembic heads` and set `down_revision` to the correct one before writing
the file, and check what `railway` pins.

## Money and reports

Money accounts are untouched: no write-off, of either disposition, creates a
money movement.

Turnover is untouched: a write-off is not a sale and never enters
`GET /api/sales/summary`.

`GET /api/write-offs/summary?period=this_month` returns total cost, plus
breakdowns by `reason_code` and by `disposition`, over the company timezone —
reusing the same period helper the other reports use, never hand-rolled dates.

The profit report (`ProfitReport`: `revenue`, `cost`, `profit`,
`profit_margin_percent`, `sales_count`) gains two fields and changes none:

- `write_off_cost` — the period's total write-off cost.
- `profit_after_write_offs` = `profit` − `write_off_cost`.

`revenue`, `cost`, `profit` and `profit_margin_percent` keep their current
meaning and value, so existing frontend pages and the MCP `get_profit_report`
tool do not break. The UI shows the loss as its own line rather than folding it
silently into profit.

## Frontend

New route `(protected)/write-offs/`, wrapped in `ModuleGuard` on `inventory`,
with a nav entry beside the other inventory pages.

**List** — date, disposition badge («Утилизировано» / «Возврат поставщику»),
reason, supplier, item count, total cost. Filters mirror the API.

**New act form** — a two-button switch at the top («Списание» / «Возврат
поставщику»); the supplier select appears only for a return. Then the reason
select, then product rows using the same search-and-unit-picker the POS cart
uses, then notes. Submit generates an `Idempotency-Key` through the existing
helper in `src/lib/api.ts`.

UI strings are Russian, matching the rest of the app: «Списания», «Новый акт»,
«Порча», «Бой», «Заводской брак», «Просрочка», «Утеряно», «Недостача»,
«Внутреннее использование».

## Testing

**Backend integration** (`tests/integration/`):

- a document consumes the right FIFO layers at their real cost, and `total_cost`
  equals the sum of what was consumed — not `quantity * cost_price`;
- stock below the requested quantity → 400, and nothing is written;
- `returned_to_supplier` without a supplier → 400; `disposed` with one → 400;
- a supplier from another company → 400;
- replaying the same `Idempotency-Key` returns the same document and does not
  consume stock twice;
- a non-manager `inventory` member is refused `POST`, allowed `GET`;
- another company's documents are invisible.

**Backend unit** — reason/disposition validation and unit-to-base conversion.

**Frontend** — vitest on the form: supplier required for a return, forbidden for
a disposal, and the submitted payload shape.

## Out of scope

Expiry and batch tracking, FEFO. Supplier debt or refunds. Editing or voiding a
document. Warehouse locations and stock transfers — when those arrive they may
absorb this table into a generic stock-document spine, which is easy in that
direction and hard in reverse.
