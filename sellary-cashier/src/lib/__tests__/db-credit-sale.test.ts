import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function base(over: Partial<import('../db').NewSaleInput> = {}): import('../db').NewSaleInput {
  return {
    client_sale_id: over.client_sale_id ?? 'c-1',
    idempotency_key: over.idempotency_key ?? 'i-1',
    subtotal: 100, discount_amount: 0, tax_amount: 0, total_amount: 100,
    paid_amount: over.paid_amount ?? 0, change_amount: 0,
    payment_method: over.payment_method ?? 'cash', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    customer_client_id: over.customer_client_id,
    initial_payment_method: over.initial_payment_method,
    created_at_client: over.created_at_client ?? '2025-01-01T08:00:00.000Z',
    items: over.items ?? [
      { product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 2,
        unit_price: 50, tax_percent: 0, line_subtotal: 100, line_total: 100, sort_order: 0 },
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  db = await import('../db');
});

describe('insertSale — credit fields', () => {
  it('persists customer_client_id + initial_payment_method + payment_method=credit', async () => {
    const { saleId } = await db.insertSale(
      base({ payment_method: 'credit', customer_client_id: 'cust-1',
             paid_amount: 30, initial_payment_method: 'cash' }),
    );
    const sale = await db.getSaleWithItems(saleId);
    expect(sale?.payment_method).toBe('credit');
    expect(sale?.customer_client_id).toBe('cust-1');
    expect(sale?.initial_payment_method).toBe('cash');
    expect(sale?.paid_amount).toBe(30);
  });

  it('leaves the credit columns NULL for an ordinary cash sale', async () => {
    const { saleId } = await db.insertSale(base({ payment_method: 'cash' }));
    const sale = await db.getSaleWithItems(saleId);
    expect(sale?.payment_method).toBe('cash');
    expect(sale?.customer_client_id).toBeNull();
    expect(sale?.initial_payment_method).toBeNull();
  });

  it('still decrements stock for a credit sale (stock path unchanged)', async () => {
    await db.insertSale(base({ payment_method: 'credit', customer_client_id: 'cust-1' }));
    expect(fake.stockOf(1)).toBe(98);
  });
});
