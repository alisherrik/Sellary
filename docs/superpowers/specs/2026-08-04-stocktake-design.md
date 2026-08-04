# Stocktake: replace the silent stock edit with an audited count

**Date:** 2026-08-04
**Status:** Approved

## Problem

Editing a product silently changes its stock.

`sellary-frontend/src/app/(protected)/products/page.tsx:419-429` diffs the stock field
against the cached product and posts the difference to `POST /api/inventory/adjust`:

```tsx
const { stock_quantity: desiredStockQuantity, ...productData } = data;
const quantityChange = Number(
  (desiredStockQuantity - editingProduct.stock_quantity).toFixed(3),
);
```

Two defects follow from this.

**1. The reason is a fixed string.** Every one of these writes lands in `inventory_logs`
with `reason = 'Корректировка остатка при редактировании товара'`. Production holds **146**
such rows. Many drive stock straight to zero. An operator who opens a product to fix a
price and touches the stock box has written off inventory with no stated cause.

**2. The delta is computed against stale data.** `editingProduct.stock_quantity` comes from
a TanStack Query cache; the server applies the delta to the *current* value. If the cashier
sells three units while the products page is open, an operator who sees 30 and types 40 gets
37, not 40 — silently.

Neither write appears in the purchase report or the sales report, so the discrepancy is
invisible until someone counts the shelf.

### Scope

This spec covers step C of the inventory-integrity plan: stop the bleeding and provide the
counting tool. It explicitly does **not**:

- correct the stock of the 134 products already affected — that requires a physical count
  (step G) using the tool this spec builds;
- change product deletion, which destroys stock through a different path (step B).

## Design

### Backend

A new endpoint accepts an **absolute counted quantity** instead of a delta, and refuses to
write when the operator's view of stock is out of date.

#### Schemas — `schemas/inventory_log.py`

Known causes already have a home. Spoiled, broken or defective goods leave the shelf as a
`stock_write_offs` document, which records `reason_code`, `disposition` and the cost the
ledger actually consumed. Repeating those here would be a second channel for one fact — the
mistake that let `stock_quantity` drift from its layers in the first place. So the taxonomy
carries only what counting itself can tell you: the count was right, it was high, it was
low, or something else.

```python
class StocktakeReason(str, Enum):
    stocktake = "stocktake"  # Инвентаризация (пересчёт)
    surplus   = "surplus"    # Излишек
    shortage  = "shortage"   # Недостача
    other     = "other"      # Прочее


class StocktakeRequest(BaseModel):
    product_id:        int
    counted_quantity:  Decimal = Field(ge=0)
    expected_quantity: Decimal
    reason:            StocktakeReason
    note:              Optional[str] = Field(None, max_length=255)
```

`counted_quantity` is what is physically on the shelf, so it cannot be negative.
`expected_quantity` is the stock the operator was shown when the dialog opened; it is the
optimistic-concurrency token and carries **no** lower bound — offline sync tolerates
oversell (`services/sync_service.py:388`), so a product can legitimately sit below zero and
must still be countable.

#### Service — `InventoryService.apply_stocktake`

1. `product_repo.get_by_id_for_update(company_id, product_id)` — row lock, tenant-scoped.
   A missing product raises `ValueError` → 400, matching `/adjust`.
2. If `product.stock_quantity != expected_quantity`, raise `StocktakeConflictError`
   carrying the current quantity. The API maps it to **409**. Nothing is written.
3. `delta = counted_quantity - product.stock_quantity`. If `delta == 0`, return the
   unchanged product and write **no** log row — counting and confirming a correct figure is
   not a stock movement.
4. `delta > 0` → `ledger.add_layer(unit_cost=product.cost_price, source_type="manual_adjustment")`.
   `delta < 0` → `ledger.consume_fifo(consumer_type="manual_adjustment")`.
   Both mirror the existing `adjust_stock` paths, so FIFO layers, `inventory_value` and
   weighted-average cost stay consistent.

The ledger call receives `reference_type=reason.value` and a composed `reason` string:
the Russian label, the counted and expected figures, and the operator note when present.

Storing the reason taxonomy in `reference_type` — rather than `manual_adjust` for
everything — means the planned stock-movement report can group by cause with no schema
change. `inventory_logs.reference_type` is already `VARCHAR`, so **no migration is
required**, and `railway.toml`'s `preDeployCommand` pin stays at `a8b9c0d1e2f3`.

#### API — `POST /api/inventory/stocktake`

Same guards as `/adjust` and the write-off document: `require_module("inventory",
"manager")`, mandatory `Idempotency-Key`, single `db.commit()` at the end. Response:

```json
{"product_id": 14, "product_name": "Рс Кола 1.5л Сиё",
 "previous_quantity": "51.000", "new_quantity": "57.000", "delta": "6.000"}
```

`POST /api/inventory/adjust` is left in place — other clients and tests use it — but the
web frontend stops calling it.

### Frontend

| File | Change |
|---|---|
| `products/page.tsx:254-283` | drop the `inventoryApi.adjust` call from `updateProductMutation` |
| `products/page.tsx:419-429` | drop the `quantityChange` computation |
| `products/page.tsx` (form) | render the stock field **only when creating**; editing has no stock input |
| `products/StocktakeModal.tsx` | **new** — the count dialog |
| `lib/api.ts` | add `inventoryApi.stocktake` |

Initial stock on product creation stays. It is a genuine opening balance, it is recorded as
a `product_initial` FIFO layer, and a brand-new product has no prior figure to corrupt.

`page.tsx` is already 1210 lines, so the dialog is a separate component rather than another
block inside it.

**The dialog** takes a product and, on open, fetches that product fresh via
`GET /api/products/{id}` — the cached list value is display-only and must not become
`expected_quantity`. It shows the system quantity, a counted-quantity input, the live
difference, a reason select and an optional note. Submit posts absolute values.

On **409** it shows "Остаток изменился (сейчас: N). Проверьте и повторите", replaces the
expected quantity with the server's figure, and keeps the dialog open so the count is
re-confirmed rather than re-applied blindly.

## Testing

**Backend**

- a positive count adds stock and writes one log row with the chosen `reference_type`
- a negative count consumes FIFO layers and leaves `inventory_value` consistent
- `expected_quantity` mismatch → 409, and stock is unchanged
- zero delta → 200 and **no** new `inventory_logs` row
- a cashier-role user → 403
- a missing `Idempotency-Key` → 400; a repeated key replays the first response

**Frontend**

- submitting the edit form no longer issues any `/inventory/adjust` request
- the stock input is absent when editing and present when creating
- the dialog posts `counted_quantity` and `expected_quantity`, not a delta
- a 409 response keeps the dialog open and surfaces the server's quantity

## Consequences

Stock can still be changed — deliberately, by a manager or admin, with a stated cause, and
never as a side effect of editing a price. Every change carries its reason into
`inventory_logs`, which is what makes the planned stock-movement report able to answer
"where did the units go".

The 134 products already carrying a silent loss are unaffected by this change. They are
corrected by counting them through this dialog.
