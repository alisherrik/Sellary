import { fetchBootstrap, pushSales } from './api';
import type { SyncSale, SyncSaleResult } from './api';
import { upsertProducts, upsertCategories, setMeta } from './db';
import type { SaleWithItems } from './db';

/**
 * Build the SyncSale payload deterministically from structured columns and push it.
 * Pure + mutex-free: the engine owns the single-flight lock and all state writes.
 */
export async function pushOnce(sendable: SaleWithItems[]): Promise<SyncSaleResult[]> {
  const payload: SyncSale[] = sendable.map((s) => ({
    client_sale_id: s.client_sale_id,
    idempotency_key: s.idempotency_key,
    created_at_client: s.created_at_client,
    payment_method: s.payment_method,
    card_type: s.card_type ?? null,
    discount_amount: s.discount_amount ?? 0,
    paid_amount: s.paid_amount ?? 0,
    change_amount: s.change_amount ?? 0,
    notes: s.notes ?? null,
    items: s.items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity, // base units
      sell_price: it.unit_price,
    })),
  }));
  const res = await pushSales(payload);
  return res.results;
}

/**
 * Full-refresh catalog pull (spec §5.2). Per contract §4.1, stock reconciliation
 *   local_stock(p) = server_stock(p) - Σ base_qty(p) over sales sync_status ∈ {pending,syncing,failed}
 * lives ENTIRELY inside `upsertProducts` (the sole subtractor). pullCatalog MUST forward the
 * RAW server snapshot — pre-subtracting here would double-count (local = server − 2×Σunsynced),
 * halving offline stock on every reconnect.
 */
export async function pullCatalog(): Promise<{ products: number; categories: number }> {
  const bootstrap = await fetchBootstrap();
  await upsertCategories(bootstrap.categories);
  await upsertProducts(bootstrap.products); // RAW products — upsertProducts subtracts unsynced qty
  await setMeta('last_catalog_pull_at', bootstrap.server_time);
  return { products: bootstrap.products.length, categories: bootstrap.categories.length };
}
