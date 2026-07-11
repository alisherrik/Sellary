import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => fake },
}));

let db: typeof import('../db');

function saleInput(over: Partial<import('../db').NewSaleInput> = {}): import('../db').NewSaleInput {
  return {
    client_sale_id: over.client_sale_id ?? 'c-1',
    idempotency_key: over.idempotency_key ?? 'i-1',
    subtotal: over.subtotal ?? 30,
    discount_amount: over.discount_amount ?? 0,
    tax_amount: over.tax_amount ?? 0,
    total_amount: over.total_amount ?? 30,
    paid_amount: over.paid_amount ?? 30,
    change_amount: over.change_amount ?? 0,
    payment_method: over.payment_method ?? 'cash',
    card_type: over.card_type ?? null,
    notes: over.notes ?? null,
    cashier_user_id: over.cashier_user_id ?? 7,
    cashier_username: over.cashier_username ?? 'kassa',
    created_at_client: over.created_at_client ?? '2025-01-01T08:00:00.000Z',
    items: over.items ?? [
      { product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 3,
        unit_price: 10, tax_percent: 0, line_subtotal: 30, line_total: 30, sort_order: 0 },
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  fake.seedProduct({ id: 2, stock_quantity: 50 });
  db = await import('../db');
});

describe('insertSale', () => {
  it('assigns MAX(id)+1 and MAX(receipt_no)+1 on the single device', async () => {
    const a = await db.insertSale(saleInput({ client_sale_id: 'c-1' }));
    const b = await db.insertSale(saleInput({ client_sale_id: 'c-2', idempotency_key: 'i-2' }));
    expect(a).toEqual({ saleId: 1, receiptNo: 1 });
    expect(b).toEqual({ saleId: 2, receiptNo: 2 });
  });

  it('inserts children then parent and decrements base-unit stock, flagging stock_applied=1', async () => {
    await db.insertSale(saleInput());
    expect(fake.stockOf(1)).toBe(97); // 100 - 3
    const sale = await db.getSaleWithItems(1);
    expect(sale?.stock_applied).toBe(1);
    expect(sale?.items).toHaveLength(1);
    expect(sale?.items[0].quantity).toBe(3);
    expect(sale?.sync_status).toBe('pending');
  });

  it('exactly-once: a crash between parent-insert and decrement heals via reconcileLocalState', async () => {
    // Simulate the crash: raw children-first + parent with stock_applied=0, no decrement.
    await fake.execute(
      `INSERT INTO sale_items (sale_id, product_id, product_name, uom, quantity, unit_price, line_subtotal, line_total, sort_order)
       VALUES (1, 2, 'B', 'pcs', 5, 10, 50, 50, 0)`
    );
    await fake.execute(
      `INSERT INTO sales (id, client_sale_id, idempotency_key, receipt_no, payment_method, sync_status, stock_applied, created_at_client)
       VALUES (1, 'crash', 'i-crash', 1, 'cash', 'pending', 0, '2025-01-01T08:00:00.000Z')`
    );
    expect(fake.stockOf(2)).toBe(50); // not yet decremented
    await db.reconcileLocalState();
    expect(fake.stockOf(2)).toBe(45); // healed exactly once
    await db.reconcileLocalState();
    expect(fake.stockOf(2)).toBe(45); // idempotent — no double decrement
  });
});
