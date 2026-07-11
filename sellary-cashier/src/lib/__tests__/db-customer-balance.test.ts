import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');
let custId: string;

async function creditSale(clientSaleId: string, total: number, paid: number) {
  return db.insertSale({
    client_sale_id: clientSaleId, idempotency_key: clientSaleId,
    subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
    paid_amount: paid, change_amount: 0, payment_method: 'credit', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    customer_client_id: custId, initial_payment_method: paid > 0 ? 'cash' : null,
    created_at_client: '2025-01-01T08:00:00.000Z',
    items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 1,
      unit_price: total, tax_percent: 0, line_subtotal: total, line_total: total, sort_order: 0 }],
  });
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 1000 });
  db = await import('../db');
  ({ clientCustomerId: custId } = await db.insertCustomer({ name: 'Ivan', phone: '1' }));
});

describe('local balance derivation (§2.4)', () => {
  it('is 0 for a fresh customer with no credit sales', async () => {
    expect(await db.getCustomerLocalBalance(custId)).toBe(0);
  });

  it('adds Σ unsynced credit remaining and subtracts Σ unsynced payments', async () => {
    await creditSale('s-1', 100, 30);                        // remaining 70
    expect(await db.getCustomerLocalBalance(custId)).toBe(70);
    await db.insertCustomerPayment({ customer_client_id: custId, amount: 20, payment_method: 'cash' });
    expect(await db.getCustomerLocalBalance(custId)).toBe(50);
  });

  it('layers unsynced deltas on top of the pulled server balance', async () => {
    // Simulate a prior server pull: raw server balance = 200.
    await fake.execute('UPDATE customers SET balance = $1 WHERE client_customer_id = $2',
      [200, custId]);
    const { saleId } = await creditSale('s-1', 100, 30);     // unsynced remaining 70
    await db.insertCustomerPayment({ customer_client_id: custId, amount: 20, payment_method: 'cash' });
    expect(await db.getCustomerLocalBalance(custId)).toBe(250);   // 200 + 70 − 20
    // Once the sale syncs it is folded into the server balance → no longer a local delta.
    await db.markSaleSynced(saleId, 999);
    expect(await db.getCustomerLocalBalance(custId)).toBe(180);   // 200 + 0 − 20
  });

  it('getCustomersWithLocalBalance (argument-less) returns every active customer with local_balance', async () => {
    await creditSale('s-1', 100, 30);                        // Ivan → local_balance 70
    await db.insertCustomer({ name: 'Boris', phone: '2' });  // → local_balance 0
    const all = await db.getCustomersWithLocalBalance();
    expect(all.map((c) => c.name)).toEqual(['Boris', 'Ivan']);   // ordered by name
    expect(all.find((c) => c.name === 'Ivan')?.local_balance).toBe(70);
    expect(all.find((c) => c.name === 'Boris')?.local_balance).toBe(0);
    // Debt tabs / search are applied client-side by the UI over this array (contract C-1).
  });
});
