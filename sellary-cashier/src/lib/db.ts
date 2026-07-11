import Database from '@tauri-apps/plugin-sql';

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
        retry_count, stock_applied, created_at_client, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [nextId, raw.client_sale_id, raw.idempotency_key, nextReceipt, raw.server_sale_id,
     raw.subtotal, raw.discount_amount, raw.tax_amount, raw.total_amount, raw.paid_amount,
     raw.change_amount, raw.payment_method, raw.card_type, raw.notes, raw.cashier_user_id,
     raw.cashier_username, raw.sync_status, raw.error_kind, raw.next_attempt_at,
     raw.first_failed_at, raw.last_error, raw.retry_count, stockApplied,
     raw.created_at_client, raw.synced_at]
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
