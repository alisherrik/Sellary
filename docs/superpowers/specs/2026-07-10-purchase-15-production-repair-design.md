# Purchase Order #15 Production Repair Design

## Goal

Safely void production purchase order `#15` for company `2` while preserving inventory balances, FIFO history, and reversal audit data. Record the repair and void as admin user `shohrom` (`user_id=4`).

## Confirmed production state

- Purchase order `#15` is `received`, is not voided, and has one active receipt.
- Its receipt created four inventory layers.
- Product `279` (`Порошок Апрел`) has an active `product_delete` allocation consuming all 10 units from the purchase layer.
- Product `280` (`Салфетка Делюкс Блок`) has an active `product_delete` allocation consuming all 5 units from the purchase layer.
- Product `252` (`Rc Cola зард 1л`) has 6 units remaining in the purchase layer while the product balance is zero. This drift came from the product-delete fallback zeroing the product balance without consuming the layer.
- The standard purchase void preview therefore returns `can_void=false` with blockers for products `279` and `280`.

## Recommended repair

Run one narrowly scoped repair operation against production. The entire repair and the standard purchase void must execute in one database transaction.

1. Lock purchase order `#15`, its active receipt, receipt items, inventory layers, affected products, and active allocations.
2. Verify that every locked row still matches the confirmed preconditions. Abort without changes on any mismatch.
3. Release the two `product_delete` allocations back to their original layers:
   - add 10 units and their original value back to product `279` and layer `246`;
   - add 5 units and their original value back to product `280` and layer `249`;
   - set each allocation's `released_quantity` to its full quantity;
   - create explicit inventory logs identifying the one-time repair.
4. Reconcile product `252` by restoring 6 units and the layer's original value to the product balance, with an explicit inventory log. The existing layer remains unchanged.
5. Re-run `preview_purchase(15)` inside the same transaction. Require `can_void=true`, no blockers, and non-negative projected product balances.
6. Call the standard `void_purchase(15, reason, user_id=4)` service. This creates the normal reversal operation, reverses the receipt layers, records void metadata, and changes the purchase status to `cancelled`.
7. Validate all postconditions, then commit. Roll back the complete transaction if any validation or service call fails.

## Expected postconditions

- Purchase order `#15` is `cancelled`, has `voided_at`, `voided_by_user_id=4`, a reason, and a reversal operation.
- Its receipt and all four receipt layers are reversed.
- The repaired `product_delete` allocations remain in history and are fully released; no audit rows are deleted.
- Resulting product quantities for the four purchase lines are:
  - product `279`: 6;
  - product `250`: 6;
  - product `252`: 0;
  - product `280`: 0.
- No affected product has negative quantity or inventory value.
- Product active/inactive flags are unchanged.

## Failure handling and rollback

The repair must refuse to run if the purchase is already voided, the expected layer/allocation identities or quantities differ, new downstream allocations appear, the preview remains blocked, projected balances are negative, or the standard void service raises an error. Any failure rolls back every repair and void mutation.

## Verification

Before commit, compare the locked rows with the preconditions and print a dry-run projection. After the transaction, query the purchase, receipt, layers, allocations, reversal operation, inventory logs, and affected product balances from a fresh connection. Do not report success unless all expected postconditions are present.

## Follow-up scope

This operation repairs only purchase order `#15`. A separate code change should later prevent product deletion from silently creating ledger drift and should represent `product_delete` blockers explicitly in the void preview UI.
