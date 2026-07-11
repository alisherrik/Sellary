import Database from '@tauri-apps/plugin-sql';
// Type-only import of the api-owned push-result type (contract C-7). SyncPaymentResult is added
// to api.ts by Task 8 (out of scope here) — do not import it before it exists, or tsc breaks.
import type { SyncCustomerResult } from './api';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:sellary_cashier.db');
  }
  return db;
}

export interface LocalProduct {
  id: number;
  barcode: string | null;
  name: string;
  uom: string;
  category_id: number | null;
  sell_price: number;
  tax_percent: number;
  stock_quantity: number;
  is_active: boolean;
  updated_at: string;
}

export async function getProducts(search?: string): Promise<LocalProduct[]> {
  const database = await getDb();
  if (search) {
    const q = `%${search}%`;
    return await database.select<LocalProduct[]>(
      'SELECT * FROM products WHERE is_active = 1 AND (name LIKE $1 OR barcode LIKE $1) ORDER BY name',
      [q]
    );
  }
  return await database.select<LocalProduct[]>(
    'SELECT * FROM products WHERE is_active = 1 ORDER BY name'
  );
}

export async function getProductById(id: number): Promise<LocalProduct | null> {
  const database = await getDb();
  const rows = await database.select<LocalProduct[]>(
    'SELECT * FROM products WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export async function getProductByBarcode(barcode: string): Promise<LocalProduct | null> {
  const database = await getDb();
  const rows = await database.select<LocalProduct[]>(
    'SELECT * FROM products WHERE barcode = $1 AND is_active = 1',
    [barcode]
  );
  return rows[0] || null;
}

export async function upsertProducts(products: LocalProduct[]): Promise<void> {
  const database = await getDb();
  // 1. Upsert authoritative server stock (resets local to server value → recompute is idempotent).
  for (const p of products) {
    await database.execute(
      `INSERT INTO products (id, barcode, name, uom, category_id, sell_price, tax_percent, stock_quantity, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(id) DO UPDATE SET
         barcode = excluded.barcode,
         name = excluded.name,
         uom = excluded.uom,
         category_id = excluded.category_id,
         sell_price = excluded.sell_price,
         tax_percent = excluded.tax_percent,
         stock_quantity = excluded.stock_quantity,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
      [p.id, p.barcode, p.name, p.uom, p.category_id, p.sell_price, p.tax_percent, p.stock_quantity, p.is_active ? 1 : 0, p.updated_at]
    );
  }
  // 2. Re-subtract not-yet-synced base qty so local = server − Σ unsynced (spec §5.2).
  const pulled = new Set(products.map((p) => p.id));
  const unsynced = await getUnsyncedBaseQtyByProduct();
  for (const [productId, qty] of unsynced) {
    if (!pulled.has(productId)) continue; // only reconcile products present in this snapshot
    await database.execute(
      'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
      [qty, productId]
    );
  }
}

export interface LocalCategory {
  id: number;
  name: string;
  is_active: boolean;
  updated_at: string | null;
}

export async function getCategories(): Promise<LocalCategory[]> {
  const database = await getDb();
  return await database.select<LocalCategory[]>(
    'SELECT * FROM categories WHERE is_active = 1 ORDER BY name'
  );
}

export async function upsertCategories(categories: LocalCategory[]): Promise<void> {
  const database = await getDb();
  for (const c of categories) {
    await database.execute(
      `INSERT INTO categories (id, name, is_active, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
      [c.id, c.name, c.is_active ? 1 : 0, c.updated_at || null]
    );
  }
}

export interface OutboxSale {
  id: number;
  client_sale_id: string;
  idempotency_key: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  request_json: string;
  response_json: string | null;
  last_error: string | null;
  created_at_client: string;
  synced_at: string | null;
  retry_count: number;
}

export async function addToOutbox(sale: Omit<OutboxSale, 'id' | 'retry_count'>): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO outbox_sales (client_sale_id, idempotency_key, status, request_json, created_at_client)
     VALUES ($1, $2, $3, $4, $5)`,
    [sale.client_sale_id, sale.idempotency_key, sale.status, sale.request_json, sale.created_at_client]
  );
  return result.lastInsertId as number;
}

export async function getPendingSales(): Promise<OutboxSale[]> {
  const database = await getDb();
  return await database.select<OutboxSale[]>(
    `SELECT * FROM outbox_sales WHERE status IN ('pending', 'syncing', 'failed')
     ORDER BY created_at_client ASC`
  );
}

export async function getOutboxSaleById(id: number): Promise<OutboxSale | null> {
  const database = await getDb();
  const rows = await database.select<OutboxSale[]>(
    'SELECT * FROM outbox_sales WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export async function updateOutboxStatus(
  id: number,
  status: OutboxSale['status'],
  responseJson?: string,
  error?: string
): Promise<void> {
  const database = await getDb();
  if (status === 'synced') {
    await database.execute(
      `UPDATE outbox_sales SET status = $1, response_json = $2, synced_at = datetime('now')
       WHERE id = $3`,
      [status, responseJson || null, id]
    );
  } else if (status === 'failed') {
    await database.execute(
      `UPDATE outbox_sales SET status = $1, last_error = $2, retry_count = retry_count + 1
       WHERE id = $3`,
      [status, error || null, id]
    );
  } else {
    await database.execute(
      'UPDATE outbox_sales SET status = $1 WHERE id = $2',
      [status, id]
    );
  }
}

export async function recoverSyncingOutboxSales(error = 'Recovered from interrupted sync'): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE outbox_sales
     SET status = 'failed',
         last_error = $1,
         retry_count = retry_count + 1
     WHERE status = 'syncing'`,
    [error]
  );
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

export async function markOutboxSalesFailed(ids: number[], error: string): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    await updateOutboxStatus(id, 'failed', undefined, error);
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select<{ value: string }[]>(
    'SELECT value FROM meta WHERE key = $1',
    [key]
  );
  return rows[0]?.value || null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function addSyncEvent(
  eventType: string,
  status: string,
  detail?: string
): Promise<void> {
  const database = await getDb();
  await database.execute(
    'INSERT INTO sync_events (event_type, status, detail) VALUES ($1, $2, $3)',
    [eventType, status, detail || null]
  );
}

export interface LocalStockChange {
  product_id: number;
  quantity: number;
}

export async function decrementLocalStock(items: LocalStockChange[]): Promise<void> {
  const database = await getDb();
  for (const item of items) {
    await database.execute(
      `UPDATE products
       SET stock_quantity = stock_quantity - $1
       WHERE id = $2`,
      [item.quantity, item.product_id]
    );
  }
}

// ---------------------------------------------------------------------------
// Local-first model (migration 002) — spec §2.3–§2.10
// ---------------------------------------------------------------------------

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';
export type ErrorKind = 'transient' | 'permanent';

export interface NewSaleItemInput {
  product_id: number;
  product_name: string;
  barcode: string | null;
  uom: string;
  quantity: number;      // BASE units
  unit_price: number;
  tax_percent: number;
  line_subtotal: number;
  line_total: number;
  sort_order: number;
}

export interface NewSaleInput {
  client_sale_id: string;
  idempotency_key: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: string;      // canonical lowercase: 'cash'|'card'|'mobile'
  card_type: string | null;    // 'alif'|'eskhata'|'dc'|null
  notes: string | null;
  cashier_user_id: number | null;
  cashier_username: string | null;
  customer_client_id?: string | null;      // set for credit sales (references customers.client_customer_id)
  initial_payment_method?: string | null;  // 'cash'|'card'|'mobile' when the initial payment > 0
  created_at_client: string;   // ISO
  items: NewSaleItemInput[];
}

export interface LocalSale {
  id: number;
  client_sale_id: string;
  idempotency_key: string;
  receipt_no: number;
  server_sale_id: number | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: string;
  card_type: string | null;
  notes: string | null;
  cashier_user_id: number | null;
  cashier_username: string | null;
  customer_client_id: string | null;
  initial_payment_method: string | null;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  next_attempt_at: string | null;
  first_failed_at: string | null;
  last_error: string | null;
  retry_count: number;
  stock_applied: number;
  acknowledged: number;
  created_at_client: string;
  synced_at: string | null;
  updated_at: string;
}

export interface LocalSaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  barcode: string | null;
  uom: string;
  quantity: number;
  unit_price: number;
  tax_percent: number;
  line_subtotal: number;
  line_total: number;
  sort_order: number;
  product_unit_id: number | null;
  sold_unit_label: string | null;
  sold_unit_factor: number | null;
  sold_quantity: number | null;
}

export interface SaleWithItems extends LocalSale {
  items: LocalSaleItem[];
}

export interface LocalProductUnit {
  id: number;
  product_id: number;
  name: string;
  factor: number;
  sell_price: number | null;
  barcode: string | null;
  is_active: number;
  sort_order: number;
  updated_at: string | null;
}

// Full sales-row shape used by insertSaleRaw (id + receipt_no are computed).
interface RawSaleRow {
  client_sale_id: string;
  idempotency_key: string;
  server_sale_id: number | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  payment_method: string;
  card_type: string | null;
  notes: string | null;
  cashier_user_id: number | null;
  cashier_username: string | null;
  customer_client_id: string | null;
  initial_payment_method: string | null;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  next_attempt_at: string | null;
  first_failed_at: string | null;
  last_error: string | null;
  retry_count: number;
  synced_at: string | null;
  created_at_client: string;
}

// Internal: decrement base-unit stock for every line of a sale, then flag stock_applied=1.
async function applyStockForSale(saleId: number): Promise<void> {
  const database = await getDb();
  const items = await database.select<{ product_id: number; quantity: number }[]>(
    'SELECT product_id, quantity FROM sale_items WHERE sale_id = $1',
    [saleId]
  );
  for (const it of items) {
    await database.execute(
      'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
      [it.quantity, it.product_id]
    );
  }
  await database.execute(
    "UPDATE sales SET stock_applied = 1, updated_at = datetime('now') WHERE id = $1",
    [saleId]
  );
}

// Crash-safe insert: children first (orphan-swept by reconcile), parent last (atomic commit
// point), then decrement when decrementNow. Reused by insertSale and the backfill.
async function insertSaleRaw(
  raw: RawSaleRow,
  items: NewSaleItemInput[],
  stockApplied: number,
  decrementNow: boolean
): Promise<{ saleId: number; receiptNo: number }> {
  const database = await getDb();
  const idRows = await database.select<{ maxId: number | null }[]>('SELECT MAX(id) AS maxId FROM sales');
  const nextId = (idRows[0]?.maxId ?? 0) + 1;
  const rcRows = await database.select<{ maxRc: number | null }[]>('SELECT MAX(receipt_no) AS maxRc FROM sales');
  const nextReceipt = (rcRows[0]?.maxRc ?? 0) + 1;

  for (const it of items) {
    await database.execute(
      `INSERT INTO sale_items
         (sale_id, product_id, product_name, barcode, uom, quantity, unit_price,
          tax_percent, line_subtotal, line_total, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [nextId, it.product_id, it.product_name, it.barcode, it.uom, it.quantity,
       it.unit_price, it.tax_percent, it.line_subtotal, it.line_total, it.sort_order]
    );
  }

  await database.execute(
    `INSERT INTO sales
       (id, client_sale_id, idempotency_key, receipt_no, server_sale_id, subtotal,
        discount_amount, tax_amount, total_amount, paid_amount, change_amount,
        payment_method, card_type, notes, cashier_user_id, cashier_username,
        sync_status, error_kind, next_attempt_at, first_failed_at, last_error,
        retry_count, stock_applied, created_at_client, synced_at,
        customer_client_id, initial_payment_method)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [nextId, raw.client_sale_id, raw.idempotency_key, nextReceipt, raw.server_sale_id,
     raw.subtotal, raw.discount_amount, raw.tax_amount, raw.total_amount, raw.paid_amount,
     raw.change_amount, raw.payment_method, raw.card_type, raw.notes, raw.cashier_user_id,
     raw.cashier_username, raw.sync_status, raw.error_kind, raw.next_attempt_at,
     raw.first_failed_at, raw.last_error, raw.retry_count, stockApplied,
     raw.created_at_client, raw.synced_at,
     raw.customer_client_id, raw.initial_payment_method]
  );

  if (decrementNow && stockApplied === 0) {
    await applyStockForSale(nextId);
  }
  return { saleId: nextId, receiptNo: nextReceipt };
}

export async function insertSale(input: NewSaleInput): Promise<{ saleId: number; receiptNo: number }> {
  const raw: RawSaleRow = {
    client_sale_id: input.client_sale_id,
    idempotency_key: input.idempotency_key,
    server_sale_id: null,
    subtotal: input.subtotal,
    discount_amount: input.discount_amount,
    tax_amount: input.tax_amount,
    total_amount: input.total_amount,
    paid_amount: input.paid_amount,
    change_amount: input.change_amount,
    payment_method: input.payment_method,
    card_type: input.card_type,
    notes: input.notes,
    cashier_user_id: input.cashier_user_id,
    cashier_username: input.cashier_username,
    customer_client_id: input.customer_client_id ?? null,
    initial_payment_method: input.initial_payment_method ?? null,
    sync_status: 'pending',
    error_kind: null,
    next_attempt_at: null,
    first_failed_at: null,
    last_error: null,
    retry_count: 0,
    synced_at: null,
    created_at_client: input.created_at_client,
  };
  return insertSaleRaw(raw, input.items, 0, true);
}

async function attachItems(sales: LocalSale[]): Promise<SaleWithItems[]> {
  const database = await getDb();
  const out: SaleWithItems[] = [];
  for (const s of sales) {
    const items = await database.select<LocalSaleItem[]>(
      'SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY sort_order ASC, id ASC',
      [s.id]
    );
    out.push({ ...s, items });
  }
  return out;
}

export async function getSaleWithItems(saleId: number): Promise<SaleWithItems | null> {
  const database = await getDb();
  const sales = await database.select<LocalSale[]>('SELECT * FROM sales WHERE id = $1', [saleId]);
  if (!sales[0]) return null;
  return (await attachItems(sales))[0];
}

export async function reconcileLocalState(): Promise<void> {
  const database = await getDb();
  // (a) sweep orphan sale_items whose parent sale never committed
  await database.execute('DELETE FROM sale_items WHERE sale_id NOT IN (SELECT id FROM sales)');
  // (b) apply stock exactly-once for any sale still flagged not-yet-applied
  const rows = await database.select<{ id: number }[]>(
    'SELECT id FROM sales WHERE stock_applied = 0 ORDER BY id ASC'
  );
  for (const r of rows) {
    await applyStockForSale(r.id);
  }
}

// ---------------------------------------------------------------------------
// Sync-worker DAOs (spec §2.10, contract §4) — operate on the `sales` table.
// ---------------------------------------------------------------------------

// Default: pending OR (failed & transient & due). With opts.includePermanent (force/manual
// resend from History/NeedsAttention), ALSO include failed & permanent (spec/contract §4.2).
export async function getSendableSales(
  nowIso: string,
  opts?: { includePermanent?: boolean }
): Promise<SaleWithItems[]> {
  const database = await getDb();
  const permanentClause = opts?.includePermanent
    ? " OR (sync_status = 'failed' AND error_kind = 'permanent')"
    : '';
  const sales = await database.select<LocalSale[]>(
    `SELECT * FROM sales
     WHERE sync_status = 'pending'
        OR (sync_status = 'failed' AND error_kind = 'transient'
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1))${permanentClause}
     ORDER BY created_at_client ASC, id ASC`,
    [nowIso]
  );
  return attachItems(sales);
}

export async function markSaleSyncing(saleId: number): Promise<void> {
  const database = await getDb();
  await database.execute(
    "UPDATE sales SET sync_status = 'syncing', updated_at = datetime('now') WHERE id = $1",
    [saleId]
  );
}

export async function markSaleSynced(saleId: number, serverSaleId: number | null): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE sales
     SET sync_status = 'synced', server_sale_id = $1, error_kind = NULL,
         next_attempt_at = NULL, last_error = NULL,
         synced_at = datetime('now'), updated_at = datetime('now')
     WHERE id = $2`,
    [serverSaleId, saleId]
  );
}

export async function markTransientFailure(saleIds: number[], nextAttemptAt: string, error: string): Promise<void> {
  if (saleIds.length === 0) return;
  const database = await getDb();
  for (const id of saleIds) {
    await database.execute(
      `UPDATE sales
       SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
           last_error = $2, retry_count = retry_count + 1,
           first_failed_at = COALESCE(first_failed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE id = $3`,
      [nextAttemptAt, error, id]
    );
  }
}

export async function markPermanentFailure(saleId: number, error: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE sales
     SET sync_status = 'failed', error_kind = 'permanent', next_attempt_at = NULL,
         last_error = $1, retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = $2`,
    [error, saleId]
  );
}

export async function recoverSyncingSales(nowIso: string): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE sales
     SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
         last_error = COALESCE(last_error, 'Recovered from interrupted sync'),
         retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now')),
         updated_at = datetime('now')
     WHERE sync_status = 'syncing'`,
    [nowIso]
  );
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

// Badge + logout gate: pending + syncing + transient-failed. EXCLUDES permanent (spec §4.1, test §14.5).
export async function getUnsyncedCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM sales
     WHERE sync_status IN ('pending','syncing')
        OR (sync_status = 'failed' AND error_kind = 'transient')`
  );
  return rows[0]?.c ?? 0;
}

// Needs-attention = permanent failures the operator has NOT yet acknowledged (contract §4.3).
// Acknowledged permanent rows drop from the count but are kept; they never block logout.
export async function getNeedsAttentionCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    "SELECT COUNT(*) AS c FROM sales WHERE sync_status = 'failed' AND error_kind = 'permanent' AND acknowledged = 0"
  );
  return rows[0]?.c ?? 0;
}

// Dismiss a permanent-failed sale from the needs-attention count without deleting the row.
export async function acknowledgeSale(saleId: number): Promise<void> {
  const database = await getDb();
  await database.execute(
    "UPDATE sales SET acknowledged = 1, updated_at = datetime('now') WHERE id = $1",
    [saleId]
  );
}

// Stock reconcile: Σ base qty over ALL non-synced sales (pending+syncing+failed incl. permanent),
// because server_stock does NOT include these (spec §5.2).
export async function getUnsyncedBaseQtyByProduct(): Promise<Map<number, number>> {
  const database = await getDb();
  const rows = await database.select<{ product_id: number; qty: number }[]>(
    `SELECT si.product_id AS product_id, SUM(si.quantity) AS qty
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.sync_status != 'synced'
     GROUP BY si.product_id`
  );
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.product_id, r.qty);
  return map;
}

// ---------------------------------------------------------------------------
// Sales-History DAOs (spec §2.10, §8.1) — operate on `sales` joined with `sale_items`.
// ---------------------------------------------------------------------------

export interface HistoryFilter {
  search?: string;
  paymentMethod?: string;                                     // falsy OR 'all' ⇒ NO filter
  syncFilter?: 'all' | 'synced' | 'unsynced' | 'attention';
  dateFrom?: string;                                          // ISO inclusive (NOT startDate)
  dateTo?: string;                                            // ISO inclusive (NOT endDate)
  limit?: number;
  offset?: number;
}

// Builds the shared WHERE clause + ordered $N params for both list and aggregates.
function buildHistoryWhere(opts: HistoryFilter): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.search) {
    const q = `%${opts.search}%`;
    params.push(q); const p1 = params.length;
    params.push(q); const p2 = params.length;
    where.push(`(s.client_sale_id LIKE $${p1} OR CAST(s.receipt_no AS TEXT) LIKE $${p2})`);
  }
  if (opts.paymentMethod && opts.paymentMethod !== 'all') {   // falsy OR 'all' ⇒ no payment filter
    params.push(opts.paymentMethod);
    where.push(`s.payment_method = $${params.length}`);
  }
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    where.push(`s.created_at_client >= $${params.length}`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    where.push(`s.created_at_client <= $${params.length}`);
  }
  if (opts.syncFilter && opts.syncFilter !== 'all') {
    if (opts.syncFilter === 'synced') where.push(`s.sync_status = 'synced'`);
    else if (opts.syncFilter === 'unsynced')
      where.push(`(s.sync_status IN ('pending','syncing') OR (s.sync_status = 'failed' AND s.error_kind = 'transient'))`);
    else if (opts.syncFilter === 'attention')
      where.push(`(s.sync_status = 'failed' AND s.error_kind = 'permanent')`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return { whereSql, params };
}

export async function getSalesHistory(opts: HistoryFilter = {}): Promise<LocalSale[]> {
  const database = await getDb();
  const { whereSql, params } = buildHistoryWhere(opts);
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  params.push(limit); const lp = params.length;
  params.push(offset); const op = params.length;
  return database.select<LocalSale[]>(
    `SELECT s.* FROM sales s ${whereSql}
     ORDER BY s.created_at_client DESC, s.id DESC
     LIMIT $${lp} OFFSET $${op}`,
    params
  );
}

export async function getHistoryAggregates(
  opts: HistoryFilter = {}
): Promise<{ turnover: number; count: number; unsynced: number; hourly: number[] }> {
  const database = await getDb();
  const { whereSql, params } = buildHistoryWhere(opts);
  const totals = await database.select<{ turnover: number; count: number; unsynced: number }[]>(
    `SELECT COALESCE(SUM(s.total_amount), 0) AS turnover,
            COUNT(*) AS count,
            COALESCE(SUM(CASE
              WHEN s.sync_status IN ('pending','syncing')
                   OR (s.sync_status = 'failed' AND s.error_kind = 'transient')
              THEN 1 ELSE 0 END), 0) AS unsynced
     FROM sales s ${whereSql}`,
    params
  );
  const hourlyRows = await database.select<{ h: number; turnover: number }[]>(
    `SELECT CAST(strftime('%H', s.created_at_client) AS INTEGER) AS h,
            COALESCE(SUM(s.total_amount), 0) AS turnover
     FROM sales s ${whereSql}
     GROUP BY h`,
    params
  );
  const hourly = new Array(24).fill(0);
  for (const r of hourlyRows) {
    if (r.h >= 0 && r.h < 24) hourly[r.h] = r.turnover;
  }
  return {
    turnover: totals[0]?.turnover ?? 0,
    count: totals[0]?.count ?? 0,
    unsynced: totals[0]?.unsynced ?? 0,
    hourly,
  };
}

export interface DeviceAuth {
  id: number;
  device_id: string;
  device_token_expires_at: string | null;
  pin_hash: string | null;
  pin_set_at: string | null;
  failed_pin_attempts: number;
  locked_until: string | null;
  user_id: number | null;
  username: string | null;
  company_id: number | null;
  company_name: string | null;
  user_role: string | null;
  last_online_auth_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceIdentityInput {
  user_id: number;
  username: string;
  company_id: number;
  company_name: string;
  user_role: string;
  device_token_expires_at: string | null;
  last_online_auth_at: string;
}

export async function getDeviceAuth(): Promise<DeviceAuth | null> {
  const database = await getDb();
  const rows = await database.select<DeviceAuth[]>('SELECT * FROM device_auth WHERE id = 1');
  return rows[0] || null;
}

export async function ensureDeviceAuth(deviceId: string): Promise<DeviceAuth> {
  const database = await getDb();
  const existing = await getDeviceAuth();
  if (existing) return existing;
  await database.execute(
    'INSERT INTO device_auth (id, device_id) VALUES (1, $1)',
    [deviceId]
  );
  const created = await getDeviceAuth();
  if (!created) throw new Error('Failed to create device_auth row');
  return created;
}

export async function setPinHash(hash: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE device_auth
     SET pin_hash = $1, pin_set_at = datetime('now'),
         failed_pin_attempts = 0, locked_until = NULL,
         updated_at = datetime('now')
     WHERE id = 1`,
    [hash]
  );
}

export async function bindDeviceIdentity(i: DeviceIdentityInput): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE device_auth
     SET user_id = $1, username = $2, company_id = $3, company_name = $4,
         user_role = $5, device_token_expires_at = $6, last_online_auth_at = $7,
         updated_at = datetime('now')
     WHERE id = 1`,
    [i.user_id, i.username, i.company_id, i.company_name, i.user_role,
     i.device_token_expires_at, i.last_online_auth_at]
  );
}

export async function recordPinFailure(lockUntil?: string | null): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE device_auth
     SET failed_pin_attempts = failed_pin_attempts + 1,
         locked_until = $1,
         updated_at = datetime('now')
     WHERE id = 1`,
    [lockUntil ?? null]
  );
}

export async function resetPinFailures(): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE device_auth
     SET failed_pin_attempts = 0, locked_until = NULL, updated_at = datetime('now')
     WHERE id = 1`
  );
}

// ---------------------------------------------------------------------------
// One-time outbox_sales → sales backfill (spec §2.8) — guarded by meta.outbox_migrated_v2.
// ---------------------------------------------------------------------------

interface LegacyOutboxRow {
  client_sale_id: string;
  idempotency_key: string;
  status: string;
  request_json: string;
  response_json: string | null;
  last_error: string | null;
  created_at_client: string;
  synced_at: string | null;
  retry_count: number;
}

interface LegacyPayload {
  payment_method?: string;
  card_type?: string | null;
  discount_amount?: number;
  paid_amount?: number;
  change_amount?: number;
  notes?: string | null;
  items?: Array<{ product_id: number; quantity: number; sell_price: number }>;
}

// One-time idempotent backfill of legacy outbox_sales into the structured sales/sale_items
// model, then a reconcile to recover offline decrements the old code lost (spec §2.8).
// Guarded by meta.outbox_migrated_v2. outbox_sales is left fully intact.
export async function migrateOutboxToSalesOnce(): Promise<void> {
  const database = await getDb();
  if ((await getMeta('outbox_migrated_v2')) === '1') return;

  const legacy = await database.select<LegacyOutboxRow[]>(
    'SELECT * FROM outbox_sales ORDER BY id ASC'
  );

  for (const row of legacy) {
    try {
      const payload = JSON.parse(row.request_json) as LegacyPayload;

      // Map legacy status → new (syncing → failed+transient).
      let syncStatus: SyncStatus = 'pending';
      let errorKind: ErrorKind | null = null;
      let stockApplied = 0;
      if (row.status === 'synced') { syncStatus = 'synced'; stockApplied = 1; }
      else if (row.status === 'failed') { syncStatus = 'failed'; errorKind = 'transient'; }
      else if (row.status === 'syncing') { syncStatus = 'failed'; errorKind = 'transient'; }
      else { syncStatus = 'pending'; }

      const legacyItems = payload.items ?? [];
      const items: NewSaleItemInput[] = legacyItems.map((it, idx) => ({
        product_id: it.product_id,
        product_name: '',                 // legacy payload has no snapshot name
        barcode: null,
        uom: 'pcs',
        quantity: it.quantity,            // BASE units (factor 1 in Phase 1)
        unit_price: it.sell_price,
        tax_percent: 0,
        line_subtotal: it.quantity * it.sell_price,
        line_total: it.quantity * it.sell_price,
        sort_order: idx,
      }));

      const subtotal = items.reduce((sum, it) => sum + it.line_subtotal, 0);
      const discount = payload.discount_amount ?? 0;
      const total = subtotal - discount;

      // best-effort server_sale_id for already-synced legacy rows
      let serverSaleId: number | null = null;
      if (row.response_json) {
        try {
          const resp = JSON.parse(row.response_json) as { sale_id?: number | null };
          serverSaleId = resp.sale_id ?? null;
        } catch { serverSaleId = null; }
      }

      const raw: RawSaleRow = {
        client_sale_id: row.client_sale_id,
        idempotency_key: row.idempotency_key,
        server_sale_id: serverSaleId,
        subtotal,
        discount_amount: discount,
        tax_amount: 0,
        total_amount: total,
        paid_amount: payload.paid_amount ?? 0,
        change_amount: payload.change_amount ?? 0,
        payment_method: (payload.payment_method ?? 'cash').toLowerCase(),
        card_type: payload.card_type ? payload.card_type.toLowerCase() : null,
        notes: payload.notes ?? null,
        cashier_user_id: null,
        cashier_username: null,
        customer_client_id: null,
        initial_payment_method: null,
        sync_status: syncStatus,
        error_kind: errorKind,
        next_attempt_at: null,
        first_failed_at: null,
        last_error: row.last_error,
        retry_count: row.retry_count,
        synced_at: row.synced_at,
        created_at_client: row.created_at_client,
      };

      // decrementNow=false: reconcile below decrements every stock_applied=0 row exactly once.
      await insertSaleRaw(raw, items, stockApplied, false);
    } catch (err) {
      await addSyncEvent(
        'backfill',
        'error',
        `Skipped malformed outbox row ${row.client_sale_id}: ${String(err)}`
      ).catch(() => undefined);
    }
  }

  // Recover the offline decrements the old sync-on-success code never applied (spec §2.8).
  await reconcileLocalState();
  await setMeta('outbox_migrated_v2', '1');
}

// ---------------------------------------------------------------------------
// Offline customers + credit (migration 003) — spec §2, §5.4; contract C-1..C-3.
// Debt balance is DERIVED on read (§2.4): never stored beyond the last server pull.
// db.ts owns id/timestamp generation for local-origin rows (contract C-2/C-3).
// ---------------------------------------------------------------------------

// Caller supplies only user-entered fields; db.ts generates client_customer_id +
// created_at_client and sets sync_status='pending' (contract C-2).
export interface NewCustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
}

export interface LocalCustomer {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  balance: number;              // server-derived debt at last pull (NOT incl. local unsynced)
  is_active: number;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  next_attempt_at: string | null;
  first_failed_at: string | null;
  last_error: string | null;
  retry_count: number;
  created_at_client: string;
  synced_at: string | null;
  updated_at: string;
}

// Balance-bearing row returned by getCustomersWithLocalBalance (contract C-1). EXACT field set
// consumed by every UI plan — do NOT rename or extend it. sync_status/error_kind are plain
// strings here (widened) so consumers need not import SyncStatus/ErrorKind.
export type CustomerWithBalance = {
  client_customer_id: string;
  server_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  local_balance: number;        // balance + Σ unsynced credit remaining − Σ unsynced payments (§2.4)
  is_active: number;
  sync_status: string;
  error_kind: string | null;
};

// Filter for getCustomers (the non-balance list). getCustomersWithLocalBalance is argument-less
// (contract C-1): the UI searches/filters the returned array client-side.
export interface CustomerFilter {
  search?: string;              // matches name OR phone
  limit?: number;
  offset?: number;
}

export async function insertCustomer(input: NewCustomerInput): Promise<{ clientCustomerId: string }> {
  const database = await getDb();
  const clientCustomerId = crypto.randomUUID();          // db.ts owns the local identity (C-2)
  const createdAtClient = new Date().toISOString();
  await database.execute(
    `INSERT INTO customers
       (client_customer_id, server_id, name, phone, email, address, description,
        balance, is_active, sync_status, retry_count, created_at_client)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, 0, 1, 'pending', 0, $7)`,
    [clientCustomerId, input.name, input.phone ?? null, input.email ?? null,
     input.address ?? null, input.description ?? null, createdAtClient]
  );
  return { clientCustomerId };
}

export async function getCustomerByClientId(clientCustomerId: string): Promise<LocalCustomer | null> {
  const database = await getDb();
  const rows = await database.select<LocalCustomer[]>(
    'SELECT * FROM customers WHERE client_customer_id = $1',
    [clientCustomerId]
  );
  return rows[0] || null;
}

export async function getCustomers(filter: CustomerFilter = {}): Promise<LocalCustomer[]> {
  const database = await getDb();
  const where: string[] = ['is_active = 1'];
  const params: unknown[] = [];
  if (filter.search) {
    const q = `%${filter.search}%`;
    params.push(q); const p1 = params.length;
    params.push(q); const p2 = params.length;
    where.push(`(name LIKE $${p1} OR phone LIKE $${p2})`);
  }
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;
  params.push(limit); const lp = params.length;
  params.push(offset); const op = params.length;
  return database.select<LocalCustomer[]>(
    `SELECT * FROM customers WHERE ${where.join(' AND ')}
     ORDER BY name ASC LIMIT $${lp} OFFSET $${op}`,
    params
  );
}

// Caller supplies only user-entered fields; db.ts generates client_payment_id + idempotency_key +
// created_at_client and sets sync_status='pending' (contract C-3).
export interface NewPaymentInput {
  customer_client_id: string;   // references customers.client_customer_id
  amount: number;
  payment_method: string;       // 'cash'|'card'|'mobile'
  description?: string | null;
}

export interface LocalCustomerPayment {
  client_payment_id: string;
  idempotency_key: string;
  customer_client_id: string;
  amount: number;
  payment_method: string;
  description: string | null;
  applied_amount: number | null;   // server-applied (may be < amount if capped-to-balance)
  server_customer_id: number | null;
  sync_status: SyncStatus;
  error_kind: ErrorKind | null;
  next_attempt_at: string | null;
  first_failed_at: string | null;
  last_error: string | null;
  retry_count: number;
  created_at_client: string;
  synced_at: string | null;
}

// One ledger row for the customer-detail view (contract C-4). `amount` is SIGNED:
// credit_sale = +remaining (total − initial paid), payment = −amount. receipt_no is the
// credit sale's receipt (null for payments); applied_amount is the payment's server-capped
// amount (null for sales, and null on a payment until it syncs / is capped).
export interface LocalLedgerEntry {
  ref_id: string;                    // client_sale_id or client_payment_id
  kind: 'credit_sale' | 'payment';
  amount: number;                    // SIGNED (see above)
  description: string | null;
  receipt_no: number | null;
  applied_amount: number | null;
  created_at_client: string;
  sync_status: string;
  error_kind: string | null;
}

export async function insertCustomerPayment(input: NewPaymentInput): Promise<{ clientPaymentId: string }> {
  const database = await getDb();
  const clientPaymentId = crypto.randomUUID();           // db.ts owns the local identity (C-3)
  const idempotencyKey = crypto.randomUUID();
  const createdAtClient = new Date().toISOString();
  await database.execute(
    `INSERT INTO customer_payments
       (client_payment_id, idempotency_key, customer_client_id, amount,
        payment_method, description, sync_status, retry_count, created_at_client)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7)`,
    [clientPaymentId, idempotencyKey, input.customer_client_id,
     input.amount, input.payment_method, input.description ?? null, createdAtClient]
  );
  return { clientPaymentId };
}

export async function getCustomerLedgerLocal(clientCustomerId: string): Promise<LocalLedgerEntry[]> {
  const database = await getDb();
  const sales = await database.select<{
    client_sale_id: string; receipt_no: number | null; total_amount: number; paid_amount: number;
    notes: string | null; sync_status: string; error_kind: string | null; created_at_client: string;
  }[]>(
    `SELECT client_sale_id, receipt_no, total_amount, paid_amount, notes,
            sync_status, error_kind, created_at_client
     FROM sales
     WHERE customer_client_id = $1 AND payment_method = 'credit'`,
    [clientCustomerId]
  );
  const pays = await database.select<{
    client_payment_id: string; amount: number; description: string | null;
    applied_amount: number | null; sync_status: string; error_kind: string | null;
    created_at_client: string;
  }[]>(
    `SELECT client_payment_id, amount, description, applied_amount,
            sync_status, error_kind, created_at_client
     FROM customer_payments
     WHERE customer_client_id = $1`,
    [clientCustomerId]
  );
  const entries: LocalLedgerEntry[] = [];
  for (const s of sales) {
    entries.push({
      ref_id: s.client_sale_id,
      kind: 'credit_sale',
      amount: s.total_amount - s.paid_amount,   // SIGNED: +remaining
      description: s.notes,
      receipt_no: s.receipt_no,
      applied_amount: null,
      created_at_client: s.created_at_client,
      sync_status: s.sync_status,
      error_kind: s.error_kind,
    });
  }
  for (const p of pays) {
    entries.push({
      ref_id: p.client_payment_id,
      kind: 'payment',
      amount: -p.amount,                        // SIGNED: −amount
      description: p.description,
      receipt_no: null,
      applied_amount: p.applied_amount,
      created_at_client: p.created_at_client,
      sync_status: p.sync_status,
      error_kind: p.error_kind,
    });
  }
  entries.sort((a, b) => (a.created_at_client < b.created_at_client ? 1 : -1));
  return entries;
}

// Read-time debt derivation (§2.4). "Unsynced" = sync_status != 'synced' (pending/syncing/failed,
// incl. permanent), mirroring the stock reconcile: server value + local-unsynced delta.
const LOCAL_BALANCE_EXPR = `
  c.balance
  + COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM sales s
       WHERE s.customer_client_id = c.client_customer_id
         AND s.payment_method = 'credit'
         AND s.sync_status != 'synced'), 0)
  - COALESCE((SELECT SUM(p.amount) FROM customer_payments p
       WHERE p.customer_client_id = c.client_customer_id
         AND p.sync_status != 'synced'), 0)`;

export async function getCustomerLocalBalance(clientCustomerId: string): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ local_balance: number }[]>(
    `SELECT (${LOCAL_BALANCE_EXPR}) AS local_balance
     FROM customers c WHERE c.client_customer_id = $1`,
    [clientCustomerId]
  );
  return rows[0]?.local_balance ?? 0;
}

// Argument-less (contract C-1): returns EVERY active customer with its derived local_balance,
// ordered by name. The UI applies search + debt tabs (Все / Есть долг / Нет долга) client-side
// over this array — no server-style filter/pagination params here.
export async function getCustomersWithLocalBalance(): Promise<CustomerWithBalance[]> {
  const database = await getDb();
  return database.select<CustomerWithBalance[]>(
    `SELECT c.client_customer_id, c.server_id, c.name, c.phone, c.email, c.address,
            c.description, c.is_active, c.sync_status, c.error_kind,
            (${LOCAL_BALANCE_EXPR}) AS local_balance
     FROM customers c
     WHERE c.is_active = 1
     ORDER BY c.name ASC`
  );
}

// Shape of a customer row shipped by GET /api/sync/bootstrap (spec C3). balance = server-derived
// debt at pull time; client_customer_id is null for server/web-origin customers (synthesize srv:<id>).
export interface ServerCustomerItem {
  id: number;
  client_customer_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  balance: number;
  is_active: boolean;
}

function serverClientId(item: ServerCustomerItem): string {
  return item.client_customer_id ?? `srv:${item.id}`;
}

export async function upsertServerCustomers(items: ServerCustomerItem[]): Promise<void> {
  const database = await getDb();
  for (const it of items) {
    const clientId = serverClientId(it);
    await database.execute(
      `INSERT INTO customers
         (client_customer_id, server_id, name, phone, email, address, description,
          balance, is_active, sync_status, retry_count, created_at_client, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'synced', 0, datetime('now'), datetime('now'))
       ON CONFLICT(client_customer_id) DO UPDATE SET
         server_id   = excluded.server_id,
         name        = excluded.name,
         phone       = excluded.phone,
         email       = excluded.email,
         address     = excluded.address,
         description = excluded.description,
         balance     = excluded.balance,
         is_active   = excluded.is_active,
         sync_status = 'synced',
         synced_at   = datetime('now'),
         updated_at  = datetime('now')`,
      [clientId, it.id, it.name, it.phone, it.email, it.address, it.description,
       it.balance, it.is_active ? 1 : 0]
    );
  }
}

// Raw server-balance overwrite only (§4 step 4). Derivation stays at read time (§2.4),
// so replaying the same server balances never double-counts.
export async function reconcileCustomerBalances(serverCustomers: ServerCustomerItem[]): Promise<void> {
  const database = await getDb();
  for (const sc of serverCustomers) {
    await database.execute(
      `UPDATE customers SET balance = $1, updated_at = datetime('now')
       WHERE client_customer_id = $2`,
      [sc.balance, serverClientId(sc)]
    );
  }
}

// Default: pending OR (failed & transient & due). includePermanent adds failed & permanent
// (force resend). Mirrors getSendableSales (§4.2).
export async function getSendableCustomers(
  nowIso: string,
  opts?: { includePermanent?: boolean }
): Promise<LocalCustomer[]> {
  const database = await getDb();
  const permanentClause = opts?.includePermanent
    ? " OR (sync_status = 'failed' AND error_kind = 'permanent')"
    : '';
  return database.select<LocalCustomer[]>(
    `SELECT * FROM customers
     WHERE sync_status = 'pending'
        OR (sync_status = 'failed' AND error_kind = 'transient'
            AND (next_attempt_at IS NULL OR next_attempt_at <= $1))${permanentClause}
     ORDER BY created_at_client ASC, client_customer_id ASC`,
    [nowIso]
  );
}

export async function markCustomerSyncing(clientCustomerId: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    "UPDATE customers SET sync_status = 'syncing', updated_at = datetime('now') WHERE client_customer_id = $1",
    [clientCustomerId]
  );
}

export async function markCustomerSynced(clientCustomerId: string, serverId: number | null): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE customers
     SET sync_status = 'synced', server_id = $1, error_kind = NULL,
         next_attempt_at = NULL, last_error = NULL,
         synced_at = datetime('now'), updated_at = datetime('now')
     WHERE client_customer_id = $2`,
    [serverId, clientCustomerId]
  );
}

export async function markCustomerTransientFailure(
  clientCustomerIds: string[], nextAttemptAt: string, error: string
): Promise<void> {
  if (clientCustomerIds.length === 0) return;
  const database = await getDb();
  for (const id of clientCustomerIds) {
    await database.execute(
      `UPDATE customers
       SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
           last_error = $2, retry_count = retry_count + 1,
           first_failed_at = COALESCE(first_failed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE client_customer_id = $3`,
      [nextAttemptAt, error, id]
    );
  }
}

export async function markCustomerPermanentFailure(clientCustomerId: string, error: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE customers
     SET sync_status = 'failed', error_kind = 'permanent', next_attempt_at = NULL,
         last_error = $1, retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now')),
         updated_at = datetime('now')
     WHERE client_customer_id = $2`,
    [error, clientCustomerId]
  );
}

export async function recoverSyncingCustomers(nowIso: string): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE customers
     SET sync_status = 'failed', error_kind = 'transient', next_attempt_at = $1,
         last_error = COALESCE(last_error, 'Recovered from interrupted sync'),
         retry_count = retry_count + 1,
         first_failed_at = COALESCE(first_failed_at, datetime('now')),
         updated_at = datetime('now')
     WHERE sync_status = 'syncing'`,
    [nowIso]
  );
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

export async function getUnsyncedCustomerCount(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM customers
     WHERE sync_status IN ('pending','syncing')
        OR (sync_status = 'failed' AND error_kind = 'transient')`
  );
  return rows[0]?.c ?? 0;
}

// Apply {client_customer_id → server_id} from a push result: set server_id + mark synced for
// synced/duplicate ONLY (contract C-6). failed rows are left untouched — the credit-sync engine
// classifies them and calls markCustomer{Transient,Permanent}Failure itself.
export async function applyCustomerIdMap(results: SyncCustomerResult[]): Promise<void> {
  for (const r of results) {
    if ((r.status === 'synced' || r.status === 'duplicate') && r.server_id != null) {
      await markCustomerSynced(r.client_customer_id, r.server_id);
    }
  }
}
