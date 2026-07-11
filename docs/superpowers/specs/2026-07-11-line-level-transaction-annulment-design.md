# Line-level Transaction Annulment Design

## Goal

Allow an administrator to annul one incorrect line in a completed sale or received purchase without annulling the other lines in the document. Inventory, money, FIFO allocations, and audit history must remain consistent.

This is a focused extension of the existing transaction-reversal and sale-return flows. It is not a new general returns module.

## User flow

### Sale line

From sale details, an administrator selects `Аннулировать позицию` on one line, enters a reason, confirms the full outstanding quantity, and selects the refund method. The existing sale-return service restores that line's FIFO allocations and applies the existing customer-ledger/refund adjustment.

The original sale and item remain visible. The item is shown as annulled when its full sold quantity has been returned. The sale becomes `partially_returned` while other active lines remain, or `returned` when every line has been fully reversed. Whole-sale annulment remains available and unchanged.

### Purchase line

From purchase details, an administrator selects `Аннулировать позицию` on one received line, enters a reason, previews the effect, and confirms. The service reverses only the active inventory layers created by receipt items belonging to that purchase-order item. Other purchase lines and their inventory layers are untouched.

If any quantity from the selected purchase line is still allocated to a sale or a later manual inventory operation, confirmation is blocked. The preview lists the blocking sale or adjustment. The administrator first annuls the corresponding sale line, which releases stock to the original FIFO layer, and then retries the purchase-line annulment.

After the incorrect chain is reversed, the administrator creates a corrected purchase and sale normally.

## Scope

Included:

- Full reversal of one selected sale item’s outstanding quantity.
- Full reversal of all received quantity for one selected purchase-order item.
- Required reason, administrator identity, timestamp, inventory impact, and idempotency.
- Existing whole-document annulment remains unchanged.
- Manager web frontend and backend APIs.

Excluded:

- Arbitrary partial-quantity purchase-line reversal.
- Editing or deleting posted history.
- Automatically creating replacement purchases or sales.
- Automatically cascading through dependent sales.
- Offline cashier reversal support.
- A new accounting or supplier-return subsystem.

## Backend design

### Sale

No new inventory algorithm is introduced. The UI submits the selected sale item and its full `quantity_returnable` through the existing sale-return endpoint. The existing service already:

- locks the sale, item, and products;
- restores exact FIFO allocations;
- updates `quantity_returned` and sale status;
- records refund and customer-ledger adjustments;
- stores the acting user, timestamp, amount, refund method, and notes.

The entered annulment reason is stored in the return notes with an explicit line-correction marker so the operation is distinguishable in history.

### Purchase

Add item-scoped endpoints:

- `GET /api/purchase-orders/{po_id}/items/{item_id}/void-preview`
- `POST /api/purchase-orders/{po_id}/items/{item_id}/void`

The POST uses the existing `VoidRequest` reason contract and requires `Idempotency-Key`. Both endpoints remain admin-only.

The preview inspects only unreversed receipt-item layers linked to the selected purchase item. It returns their combined stock/value impact and the same blocker types used by whole-purchase preview. Sale blockers identify the dependent sale and, when available, the exact sale item.

Execution locks the purchase, selected item, receipt items, inventory layers, active allocations, and affected products. It then:

1. rejects an already-annulled or unreceived item;
2. rejects active sale/manual-adjustment allocations;
3. releases internal write-off allocations using the existing ledger helper;
4. reverses each unconsumed layer with the existing ledger helper;
5. records one `ReversalOperation` with operation type `purchase_item_void`;
6. marks the purchase item annulled and recomputes the purchase net total/status;
7. flushes all changes in the same database transaction.

### Purchase item audit fields

Add these nullable fields to `purchase_order_items`:

- `voided_at`
- `voided_by_user_id`
- `void_reason`
- `reversal_operation_id`

The original ordered/received quantities and subtotal stay unchanged for audit. API responses expose the audit fields plus `is_voided`. Purchase totals and lifecycle calculations exclude voided items. If all items are voided, the purchase becomes `cancelled`; otherwise status is recomputed from the remaining active items.

No entire `PurchaseReceipt` is marked reversed for an item-only operation. The affected `InventoryLayer.reversed_at` fields and the purchase-item reversal operation are the authoritative item-level reversal trail.

## Frontend design

Purchase and sale detail tables gain an admin-only row action named `Аннулировать позицию`.

For a sale, the action reuses the existing return modal, preselects only that line, fixes quantity to its full outstanding quantity, and requires a reason. For a purchase, the action reuses the existing annulment preview/dialog pattern but calls the item-scoped endpoints.

Voided purchase rows remain visible with an `Аннулирован` badge, reason, user/time metadata when available, and disabled action controls. A blocked purchase preview shows the blocking sale number and a direct action to open that sale’s details.

## Validation and safety

- Tenant ownership is checked for both parent and selected item.
- Item IDs must belong to the route’s parent document.
- Only received purchase items with active, traceable receipt layers can be annulled.
- Legacy purchase lines without receipt-layer history remain blocked.
- Repeated POST requests with the same idempotency key return the original result.
- A second annulment attempt returns a conflict and cannot move stock twice.
- Inventory quantity/value, FIFO layers, allocations, document status, and customer balance change atomically.

## Tests

Backend tests cover:

- sale-line annulment through the existing return service;
- purchase-line preview affecting only the selected item;
- successful purchase-line reversal while sibling lines remain intact;
- blocker when selected stock was sold;
- success after the blocking sale line is reversed;
- manual-adjustment and legacy-history blockers;
- repeated/idempotent requests and cross-tenant/item-parent rejection;
- purchase total/status recomputation and audit fields.

Frontend tests cover row-action visibility, preselected sale return, purchase preview/blocker display, successful invalidation/refresh, and disabled actions for already-annulled lines.

## Success criteria

An administrator can reverse one wrong line in a large sale or purchase without changing sibling lines. If the purchase stock was sold, the system names and blocks on the dependent sale until its relevant line is reversed. After the sale line and purchase line are annulled in order, inventory and financial state match the state before those two lines were entered, while the complete audit history remains visible.
