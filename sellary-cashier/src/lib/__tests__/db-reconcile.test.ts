import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  fake.seedProduct({ id: 2, stock_quantity: 60 });
  db = await import('../db');
});

describe('reconcileLocalState', () => {
  it('deletes orphan sale_items whose parent sale row is missing', async () => {
    await fake.execute(
      `INSERT INTO sale_items (sale_id, product_id, uom, quantity, unit_price, line_subtotal, line_total)
       VALUES (999, 1, 'pcs', 4, 10, 40, 40)`
    );
    await db.reconcileLocalState();
    const rows = await fake.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM sale_items');
    expect(rows[0].c).toBe(0);
    expect(fake.stockOf(1)).toBe(100); // orphan never affects stock
  });

  it('applies stock exactly once for stock_applied=0 sales and is idempotent on re-run', async () => {
    await fake.execute(
      `INSERT INTO sale_items (sale_id, product_id, uom, quantity, unit_price, line_subtotal, line_total)
       VALUES (1, 2, 'pcs', 7, 10, 70, 70)`
    );
    await fake.execute(
      `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, stock_applied, created_at_client)
       VALUES (1, 'c', 'i', 1, 'cash', 'pending', 0, '2025-01-01T00:00:00.000Z')`
    );
    await db.reconcileLocalState();
    expect(fake.stockOf(2)).toBe(53);
    const s1 = await db.getSaleWithItems(1);
    expect(s1?.stock_applied).toBe(1);
    await db.reconcileLocalState();
    expect(fake.stockOf(2)).toBe(53); // no double decrement
  });

  it('leaves already-applied sales untouched', async () => {
    await fake.execute(
      `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, stock_applied, created_at_client)
       VALUES (1, 'c', 'i', 1, 'cash', 'synced', 1, '2025-01-01T00:00:00.000Z')`
    );
    await fake.execute(
      `INSERT INTO sale_items (sale_id, product_id, uom, quantity, unit_price, line_subtotal, line_total)
       VALUES (1, 1, 'pcs', 5, 10, 50, 50)`
    );
    await db.reconcileLocalState();
    expect(fake.stockOf(1)).toBe(100); // stock_applied=1 → not re-decremented
  });
});
