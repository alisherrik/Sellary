import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function serverProduct(id: number, stock: number): import('../db').LocalProduct {
  return { id, barcode: null, name: `P${id}`, uom: 'pcs', category_id: null,
    sell_price: 10, tax_percent: 0, stock_quantity: stock, is_active: true,
    updated_at: '2025-02-01T00:00:00.000Z' };
}
function sale(clientId: string, productId: number, qty: number): import('../db').NewSaleInput {
  return {
    client_sale_id: clientId, idempotency_key: clientId,
    subtotal: qty * 10, discount_amount: 0, tax_amount: 0, total_amount: qty * 10,
    paid_amount: qty * 10, change_amount: 0, payment_method: 'cash', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k', created_at_client: '2025-01-01T08:00:00.000Z',
    items: [{ product_id: productId, product_name: `P${productId}`, barcode: null, uom: 'pcs',
      quantity: qty, unit_price: 10, tax_percent: 0, line_subtotal: qty * 10, line_total: qty * 10, sort_order: 0 }],
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  db = await import('../db');
});

describe('upsertProducts reconciling recompute', () => {
  it('sets local = server − Σ unsynced base qty for products in the snapshot', async () => {
    await db.insertSale(sale('s1', 1, 4)); // local now 96, unsynced qty 4
    // Server snapshot reports 90 (already includes some synced history, but NOT s1).
    await db.upsertProducts([serverProduct(1, 90)]);
    expect(fake.stockOf(1)).toBe(86); // 90 − 4
  });

  it('is idempotent — pulling the same snapshot twice does not double-subtract', async () => {
    await db.insertSale(sale('s1', 1, 4));
    await db.upsertProducts([serverProduct(1, 90)]);
    await db.upsertProducts([serverProduct(1, 90)]);
    expect(fake.stockOf(1)).toBe(86);
  });

  it('does not subtract for synced sales (server already includes them)', async () => {
    const { saleId } = await db.insertSale(sale('s1', 1, 4));
    await db.markSaleSynced(saleId, 1);
    await db.upsertProducts([serverProduct(1, 90)]);
    expect(fake.stockOf(1)).toBe(90); // synced → not re-subtracted
  });

  it('converges regardless of push-before-pull vs pull-before-push', async () => {
    // pull first, then a sale, then pull again
    await db.upsertProducts([serverProduct(1, 100)]);
    await db.insertSale(sale('s1', 1, 5));
    await db.upsertProducts([serverProduct(1, 100)]); // server still 100 (sale not yet synced)
    expect(fake.stockOf(1)).toBe(95);
  });
});
