import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function sale(over: Partial<import('../db').NewSaleInput> & { total?: number } = {}): import('../db').NewSaleInput {
  const total = over.total ?? 100;
  return {
    client_sale_id: over.client_sale_id ?? 'c-1', idempotency_key: over.idempotency_key ?? 'i-1',
    subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
    paid_amount: total, change_amount: 0,
    payment_method: over.payment_method ?? 'cash', card_type: over.card_type ?? null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    created_at_client: over.created_at_client ?? '2025-01-01T08:30:00.000Z',
    items: over.items ?? [
      { product_id: 1, product_name: 'Milk', barcode: '111', uom: 'pcs', quantity: 1,
        unit_price: total, tax_percent: 0, line_subtotal: total, line_total: total, sort_order: 0 },
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  db = await import('../db');
});

describe('history DAOs', () => {
  it('getSalesHistory orders newest-first and paginates', async () => {
    await db.insertSale(sale({ client_sale_id: 'a', idempotency_key: 'a', created_at_client: '2025-01-01T08:00:00.000Z' }));
    await db.insertSale(sale({ client_sale_id: 'b', idempotency_key: 'b', created_at_client: '2025-01-01T09:00:00.000Z' }));
    await db.insertSale(sale({ client_sale_id: 'c', idempotency_key: 'c', created_at_client: '2025-01-01T10:00:00.000Z' }));
    const page1 = await db.getSalesHistory({ limit: 2, offset: 0 });
    expect(page1.map((s) => s.client_sale_id)).toEqual(['c', 'b']);
    const page2 = await db.getSalesHistory({ limit: 2, offset: 2 });
    expect(page2.map((s) => s.client_sale_id)).toEqual(['a']);
  });

  it('getSalesHistory filters by payment method and sync tab', async () => {
    await db.insertSale(sale({ client_sale_id: 'cash1', idempotency_key: 'x1', payment_method: 'cash' }));
    const { saleId } = await db.insertSale(sale({ client_sale_id: 'card1', idempotency_key: 'x2', payment_method: 'card', card_type: 'alif' }));
    await db.markSaleSynced(saleId, 1);
    expect((await db.getSalesHistory({ paymentMethod: 'card' })).map((s) => s.client_sale_id)).toEqual(['card1']);
    expect((await db.getSalesHistory({ syncFilter: 'synced' })).map((s) => s.client_sale_id)).toEqual(['card1']);
    expect((await db.getSalesHistory({ syncFilter: 'unsynced' })).map((s) => s.client_sale_id)).toEqual(['cash1']);
  });

  it('getHistoryAggregates computes turnover/count/unsynced over the whole filter, not the page', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insertSale(sale({ client_sale_id: `p${i}`, idempotency_key: `p${i}`, total: 50, created_at_client: '2025-01-01T08:15:00.000Z' }));
    }
    const { saleId } = await db.insertSale(sale({ client_sale_id: 'done', idempotency_key: 'done', total: 200, created_at_client: '2025-01-01T14:00:00.000Z' }));
    await db.markSaleSynced(saleId, 9);
    const agg = await db.getHistoryAggregates({ limit: 1, offset: 0 });
    expect(agg.turnover).toBe(350);   // 3×50 + 200 across the full filter
    expect(agg.count).toBe(4);
    expect(agg.unsynced).toBe(3);      // the 3 pending
    expect(agg.hourly[8]).toBe(150);   // three 50-sales at 08:15
    expect(agg.hourly[14]).toBe(200);
  });

  it('getSaleWithItems returns structured snapshot rows (drift-proof after product delete)', async () => {
    const { saleId } = await db.insertSale(sale({ client_sale_id: 'z', idempotency_key: 'z' }));
    await fake.execute('DELETE FROM products WHERE id = 1'); // product removed after sale
    const detail = await db.getSaleWithItems(saleId);
    expect(detail?.items[0].product_name).toBe('Milk'); // snapshot survives
    expect(detail?.items[0].barcode).toBe('111');
  });
});
