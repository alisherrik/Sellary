import { fetchBootstrap, pushSales, pushCustomers, pushPayments } from './api';
import type {
  SyncSale,
  SyncSaleResult,
  SyncCustomer,
  SyncCustomerResult,
  SyncPayment,
  SyncPaymentResult,
} from './api';
import { upsertProducts, upsertCategories, setMeta, reconcileCustomerBalances } from './db';
import type { SaleWithItems, LocalCustomer, LocalCustomerPayment } from './db';

/**
 * Build the SyncSale payload deterministically from structured columns and push it.
 * Pure + mutex-free: the engine owns the single-flight lock and all state writes.
 * Credit sales carry customer_client_id + initial_payment_method; non-credit sales send null.
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
    client_customer_id: s.customer_client_id ?? null,
    initial_payment_method: s.initial_payment_method ?? null,
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
 * Push offline-created customers. The engine applies {client_customer_id -> server_id}
 * (applyCustomerIdMap) to local rows BEFORE credit sales/payments are pushed, so the
 * server can resolve customer references in the same pass.
 */
export async function pushCustomersOnce(sendable: LocalCustomer[]): Promise<SyncCustomerResult[]> {
  const payload: SyncCustomer[] = sendable.map((c) => ({
    client_customer_id: c.client_customer_id,
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    address: c.address ?? null,
    description: c.description ?? null,
  }));
  const res = await pushCustomers(payload);
  return res.results;
}

/**
 * Push queued debt payments. The server caps each to the current balance and returns
 * applied_amount (+ an overpayment warning when capped); the engine surfaces those warnings.
 */
export async function pushPaymentsOnce(sendable: LocalCustomerPayment[]): Promise<SyncPaymentResult[]> {
  const payload: SyncPayment[] = sendable.map((p) => ({
    client_payment_id: p.client_payment_id,
    idempotency_key: p.idempotency_key,
    client_customer_id: p.customer_client_id,
    amount: p.amount,
    payment_method: p.payment_method,
    description: p.description ?? null,
  }));
  const res = await pushPayments(payload);
  return res.results;
}

/**
 * Full-refresh catalog pull (spec §5.2). Per contract §4.1, stock reconciliation
 *   local_stock(p) = server_stock(p) - Σ base_qty(p) over sales sync_status ∈ {pending,syncing,failed}
 * lives ENTIRELY inside `upsertProducts` (the sole subtractor). pullCatalog MUST forward the
 * RAW server snapshot — pre-subtracting here would double-count.
 *
 * Debt balances follow the same rule (spec §4): reconcileCustomerBalances writes the RAW
 * server balance; the local unsynced credit/payment delta is applied at read time only.
 */
export async function pullCatalog(): Promise<{ products: number; categories: number; customers: number }> {
  const bootstrap = await fetchBootstrap();
  await upsertCategories(bootstrap.categories);
  await upsertProducts(bootstrap.products); // RAW products — upsertProducts subtracts unsynced qty
  const customers = bootstrap.customers ?? [];
  await reconcileCustomerBalances(customers); // RAW balances — read-time derivation subtracts
  await setMeta('last_catalog_pull_at', bootstrap.server_time);
  return { products: bootstrap.products.length, categories: bootstrap.categories.length, customers: customers.length };
}
