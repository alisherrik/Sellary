# Sellary Transaction Reversal Design

Date: 2026-06-15
Status: Approved for implementation planning

## Summary

Sellary will not hard-delete posted sales or received purchase orders. An admin will annul a transaction by posting linked reversal movements that neutralize its inventory and reporting effects while preserving the original record and a complete audit trail.

This follows the common POS/ERP pattern used by Microsoft Dynamics, SAP, and Oracle: posted business documents are corrected through void, credit, or reversal entries rather than destructive deletion.

Draft purchase orders have no inventory effect and may continue to be deleted under the existing draft-only rule.

## Goals

- Let company admins clean up test or erroneous sales and purchases safely.
- Restore stock when a sale is annulled.
- Reverse received stock and valuation effects when a purchase is annulled.
- Prevent purchase reversal when stock originating from that purchase has already been consumed.
- Preserve original documents, reasons, actor identity, timestamps, and reversal movements.
- Exclude annulled transactions from operational totals and standard reports.
- Keep all customer-facing labels in Russian.

## Non-Goals

- Physical deletion of posted transactions.
- Allowing managers or cashiers to annul posted transactions.
- Automatic cascading annulment of dependent sales.
- Bulk company reset or production database wipe.
- Full financial general-ledger accounting in this phase.
- Training Mode implementation in this phase.

Training Mode remains the recommended follow-up so future test transactions can be isolated from live stock and reports.

## Terminology

- **Cancel**: stop an unposted workflow that has not changed inventory.
- **Annul/Void**: neutralize a posted transaction using reversal movements.
- **Reversal**: a new immutable movement with the opposite business effect.
- **Inventory layer**: a quantity and unit-cost batch created by a receipt or positive adjustment.
- **Allocation**: a record connecting an outgoing quantity to the inventory layer it consumed.
- **Blocker**: a later transaction that prevents a purchase receipt from being reversed safely.

## Permissions

Only a company membership with role `admin` may:

- preview a sale or purchase annulment;
- annul a posted sale;
- annul a partially or fully received purchase;
- view dependency details needed for the annulment.

The backend must enforce this with `require_admin`. Hiding buttons in the frontend is not sufficient authorization.

Super-admin company entry inherits the effective company `admin` role and may use the same endpoints.

## Transaction Lifecycle

### Sales

Existing states remain valid. A posted sale annulment ends in `cancelled` and gains explicit audit metadata. The Russian UI label for this state becomes `Аннулирован` in sales contexts.

A sale can be annulled once. Repeating the same request with the same idempotency key returns the original result. A second independent annulment request returns a conflict.

Required audit fields:

- `voided_at`
- `voided_by_user_id`
- `void_reason`
- optional `reversal_operation_id`

### Purchase Orders

- `draft`: may be edited or deleted because it has no posted stock movement.
- `sent`: may be cancelled without inventory reversal if nothing was received.
- `partially_received` or `received`: may only be annulled by an admin through the reversal workflow.
- `cancelled`: terminal and cannot be annulled again.

The current behavior that permits cancelling a partially received purchase without reversing received stock must be removed. It creates an inconsistent document/stock state.

Required audit fields mirror sales:

- `voided_at`
- `voided_by_user_id`
- `void_reason`
- optional `reversal_operation_id`

## Inventory Ledger

Sellary will add immutable inventory receipt layers and outgoing allocations while retaining `products.stock_quantity` as a fast current balance.

### Receipt Layers

Each positive stock source creates a layer containing:

- company and product;
- source type and source ID;
- received quantity;
- remaining quantity;
- unit cost;
- creation timestamp;
- reversal linkage when annulled.

Purchase receipt layers point to a specific purchase receipt item. Positive manual adjustments create manual layers using the product cost effective at the time of adjustment.

### Purchase Receipt Events

Partial receiving requires first-class receipt records instead of relying only on `purchase_order_items.quantity_received`.

Each receive action creates:

- a purchase receipt header;
- one or more receipt items;
- inventory layers for the received quantities;
- existing inventory logs for human-readable history.

The aggregate `quantity_received` remains available but is derived and validated against receipt events.

### FIFO Allocations

New sales consume available receipt layers in FIFO order. Each sale item records which layers supplied its quantity.

This linkage answers the question: "Was stock from purchase X sold, and by which sales?"

The product's displayed `cost_price` may continue to use weighted average cost. FIFO allocations are introduced for lineage and exact reversal safety; they do not silently change the current pricing UI or historical sale pricing contract.

### Returns and Sale Annulments

A product return releases quantity back to the same source allocations where possible. A full sale annulment restores only the net quantity that has not already been returned.

Example:

- Sale quantity: 10
- Already returned: 3
- Sale annulment stock restoration: 7

This prevents double restoration.

## Sale Annulment Flow

1. Lock the sale, its items, related allocations, and affected products.
2. Reject if the sale is already annulled.
3. Calculate each item's outstanding quantity: sold minus already returned.
4. Restore outstanding quantities to their original inventory layers.
5. Increase `products.stock_quantity` by the same total.
6. Create opposite inventory movements linked to the original sale and reversal operation.
7. Mark the sale `cancelled` and save reason, admin, and timestamp.
8. Commit all changes in one database transaction.

The original sale, items, returns, and original inventory logs remain unchanged.

Sellary currently records payment method but does not settle through an external payment gateway. Sale annulment therefore reverses the internal POS, stock, and reporting effects only. A future payment integration must add a separate provider refund/void step with its own failure handling.

## Purchase Annulment Flow

### Preview

Before confirmation, the backend returns:

- quantities that would leave stock;
- valuation impact;
- affected products;
- whether reversal is allowed;
- blocking sales with sale number, date, product, and allocated quantity.

### Blocking Rule

A received purchase cannot be annulled while any non-annulled outgoing allocation consumes one of its layers.

The UI does not automatically annul dependent sales. It tells the admin which sales must be annulled first. This avoids surprising cascading changes and gives the admin control over refunds and operational consequences.

### Execution

When no blockers remain:

1. Lock the purchase, receipt events, layers, and affected products.
2. Verify every relevant layer is fully available.
3. Decrease product stock by the received quantities.
4. Mark layers and receipt events as reversed through linked opposite movements.
5. Recompute the product's weighted cost from remaining positive inventory value. If stock becomes zero, retain the last known cost rather than divide by zero.
6. Mark the purchase `cancelled` and save reason, admin, and timestamp.
7. Commit all changes atomically.

## Legacy Data Cutover

Existing production data predates inventory layers, so Sellary must not invent exact purchase-to-sale relationships that cannot be proven.

At deployment:

- create an opening-balance layer per product for its current positive stock and current cost;
- mark transactions created before the ledger cutover timestamp as legacy;
- use exact FIFO lineage for all new receipts, sales, returns, and adjustments after cutover.

Legacy behavior:

- legacy sales may be annulled by restoring their net outstanding quantity and creating reversal logs;
- legacy draft or unreceived purchases follow normal cancellation rules;
- legacy received purchases may be annulled only when a conservative stock-history check proves there were no later stock-consuming movements for the affected products;
- otherwise the preview blocks the action and explains that exact dependency data is unavailable for the legacy transaction.

This policy favors inventory correctness over guessing. It also allows current test sales to be cleaned while preventing unsafe purchase rollback.

## API Design

All mutation endpoints require `Idempotency-Key`.

### Sale

- `GET /api/sales/{sale_id}/void-preview`
- `POST /api/sales/{sale_id}/void`

Request body:

```json
{
  "reason": "Тестовая продажа"
}
```

### Purchase

- `GET /api/purchase-orders/{po_id}/void-preview`
- `POST /api/purchase-orders/{po_id}/void`

The preview response includes `can_void`, stock/valuation impacts, and `blockers`.

Conflict responses use HTTP 409 for already-annulled transactions, invalid lifecycle state, or dependency blockers. Missing documents return 404. Non-admin access returns 403.

Existing `DELETE /purchase-orders/{id}` remains draft-only.

## UI Design

### Sales History

Admin-only action in the sale detail panel:

- button: `Аннулировать продажу`
- dialog title: `Аннулирование продажи`
- required field: `Причина аннулирования`
- impact section: `Влияние на остатки`
- warning: `Операция необратима. Продажа останется в истории.`
- confirmation: `Аннулировать`

After success, the sale remains visible with status `Аннулирован`. Standard totals exclude it.

### Purchase Detail

Admin-only action:

- button: `Аннулировать закупку`
- dialog title: `Аннулирование закупки`
- impact section: `Влияние на остатки и себестоимость`
- blockers heading: `Связанные продажи`
- blocker guidance: `Сначала аннулируйте связанные продажи.`

When blockers exist, the confirmation button is disabled and each sale links to its sales-history detail.

### Visibility

Managers and cashiers do not see annulment actions. They may still view annulled transactions according to current page access rules.

## Reporting

- Annulled sales do not contribute to turnover, tax, profit, average check, or sold quantities.
- Returns belonging to an annulled sale are also excluded from refund totals so the sale and its returns are not counted twice.
- Annulled purchase receipts do not contribute to received quantities or inventory valuation.
- Reports may expose a separate annulment count and amount later, but this is not required for the first implementation.
- Audit and inventory-history views continue to show original and reversal movements.

## Audit and Immutability

Every reversal operation records:

- company;
- entity type and entity ID;
- operation type;
- reason;
- admin user;
- timestamp;
- idempotency key/request identity;
- structured before/after stock impact.

Original inventory log rows are never edited or deleted. Reversal logs reference the original transaction and, where available, the original movement.

## Concurrency and Transactions

- Lock rows in deterministic product-ID order to reduce deadlock risk.
- Recheck blockers after locks are acquired; preview alone is not authorization to execute.
- Stock, layers, allocations, receipt records, audit data, and document status commit together.
- Any failure rolls back the complete operation.
- A reversal must never produce negative stock.

## Error Messages

User-facing messages remain Russian:

- `Только администратор может аннулировать операцию.`
- `Продажа уже аннулирована.`
- `Закупку нельзя аннулировать: часть товара уже использована в продажах.`
- `Сначала аннулируйте связанные продажи.`
- `Для старой закупки невозможно безопасно определить связанные операции.`
- `Остатки изменились. Обновите данные и повторите попытку.`

## Testing Strategy

Backend tests must cover:

- admin authorization and manager/cashier rejection;
- idempotent repeated requests;
- sale annulment restoring full stock;
- partially returned sale restoring only outstanding stock;
- purchase annulment with no allocations;
- purchase preview listing blocking sales;
- purchase annulment rejected while blockers exist;
- success after blockers are annulled;
- weighted cost recalculation;
- legacy safety rules;
- tenant isolation;
- concurrent attempts and rollback on failure;
- reports excluding annulled transactions.

Frontend tests must cover:

- actions visible only to admins;
- Russian labels and required reason validation;
- preview impact rendering;
- blocker links and disabled confirmation;
- query invalidation and status refresh after success;
- API error messages.

Browser verification must exercise:

1. Receive a purchase.
2. Sell part of its stock.
3. Confirm purchase annulment is blocked and names the sale.
4. Annul the sale and verify stock restoration.
5. Annul the purchase and verify stock/valuation reversal.
6. Confirm both original records remain visible as `Аннулирован`.

## Rollout

1. Add schema and migration for audit fields, receipt events, layers, allocations, and reversal operations.
2. Create opening-balance layers and a ledger cutover marker.
3. Implement backend preview and reversal services behind admin-only endpoints.
4. Update reports and inventory queries.
5. Add Russian admin UI flows.
6. Run backend, frontend, and browser verification.
7. Deploy backend/database first, then frontend.

## Future Training Mode

The preferred long-term test workflow is an explicit `Учебный режим` where training sales and purchases are separated from live transactions, stock, receipts, and reports. This prevents repeated production cleanup and follows established POS practice. It should be designed as a separate feature after reversal support is stable.

## References

- [Microsoft Dynamics 365 Business Central: Correct or cancel a posted sales invoice](https://learn.microsoft.com/en-ca/dynamics365/business-central/sales-how-correct-cancel-sales-invoice)
- [Microsoft Dynamics 365 Business Central: Process purchase returns or cancellations](https://learn.microsoft.com/en-ca/dynamics365/business-central/purchasing-how-process-purchase-returns-cancellations)
- [SAP: Cancelling a material document](https://help.sap.com/docs/SAP_ERP/96bf9ad642cf4b26a29595e3d573fb8c/4963bd534f22b44ce10000000a174cb4.html)
- [Oracle Retail Xstore: Post voiding a transaction](https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/21.0/rpxmg/voiding-transaction.htm)
- [Oracle Retail Xstore: Training Mode](https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/21.0/rpxmg/training-mode.htm)
- [Stripe: Sandboxes](https://docs.stripe.com/sandboxes)
