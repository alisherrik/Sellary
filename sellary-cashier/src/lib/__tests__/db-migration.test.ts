import { describe, it, expect } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

async function tableNames(db: FakeDatabase): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  return rows.map((r) => r.name);
}
async function indexNames(db: FakeDatabase): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
  );
  return rows.map((r) => r.name);
}

describe('migration 002_local_first', () => {
  it('creates the local-first tables additively without touching 001 tables', async () => {
    const db = createTestDb();
    const tables = await tableNames(db);
    expect(tables).toEqual(expect.arrayContaining([
      'sales', 'sale_items', 'product_units', 'device_auth',
      'products', 'categories', 'outbox_sales', 'meta', 'sync_events',
    ]));
  });

  it('creates the hot-path indexes', async () => {
    const db = createTestDb();
    const idx = await indexNames(db);
    expect(idx).toEqual(expect.arrayContaining([
      'idx_sales_sync_status', 'idx_sales_created_desc', 'idx_sales_receipt_no',
      'idx_sale_items_sale_id', 'idx_product_units_product',
      'idx_products_barcode', 'idx_products_name',
    ]));
  });

  it('enforces device_auth single-row CHECK (id = 1)', async () => {
    const db = createTestDb();
    await db.execute("INSERT INTO device_auth (id, device_id) VALUES (1, 'dev-1')");
    await expect(
      db.execute("INSERT INTO device_auth (id, device_id) VALUES (2, 'dev-2')")
    ).rejects.toThrow();
  });

  it('enforces sales.sync_status CHECK set (no duplicate)', async () => {
    const db = createTestDb();
    await expect(
      db.execute(
        `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, created_at_client)
         VALUES (1, 'c1', 'i1', 1, 'cash', 'duplicate', '2025-01-01T00:00:00.000Z')`
      )
    ).rejects.toThrow();
  });
});
