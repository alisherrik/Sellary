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

export async function recoverSyncingSales(error = 'Recovered from interrupted sync'): Promise<number> {
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
