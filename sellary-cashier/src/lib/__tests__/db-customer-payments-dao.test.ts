import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

async function seedCreditSale(clientSaleId: string, total: number, paid: number, when: string) {
  await db.insertSale({
    client_sale_id: clientSaleId, idempotency_key: clientSaleId,
    subtotal: total, discount_amount: 0, tax_amount: 0, total_amount: total,
    paid_amount: paid, change_amount: 0, payment_method: 'credit', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    customer_client_id: 'cust-1', initial_payment_method: paid > 0 ? 'cash' : null,
    created_at_client: when,
    items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 1,
      unit_price: total, tax_percent: 0, line_subtotal: total, line_total: total, sort_order: 0 }],
  });
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  db = await import('../db');
});

describe('customer payment outbox', () => {
  it('insertCustomerPayment generates ids + timestamp and stores a pending outbox row', async () => {
    const { clientPaymentId } = await db.insertCustomerPayment({
      customer_client_id: 'cust-1', amount: 40, payment_method: 'cash',
    });
    expect(clientPaymentId).toBeTruthy();          // db-generated uuid
    const rows = await fake.select<import('../db').LocalCustomerPayment[]>(
      'SELECT * FROM customer_payments WHERE client_payment_id = $1', [clientPaymentId]);
    expect(rows[0].amount).toBe(40);
    expect(rows[0].sync_status).toBe('pending');
    expect(rows[0].applied_amount).toBeNull();
    expect(rows[0].idempotency_key).toBeTruthy();  // db-generated
    expect(rows[0].created_at_client).toBeTruthy();
  });

  it('getCustomerLedgerLocal merges credit sales + payments newest-first with SIGNED amounts', async () => {
    await seedCreditSale('s-1', 100, 30, '2025-01-01T08:00:00.000Z');
    await db.insertCustomerPayment({ customer_client_id: 'cust-1', amount: 20, payment_method: 'cash' });
    const ledger = await db.getCustomerLedgerLocal('cust-1');
    // the payment carries a db-generated (current-date) timestamp → newest-first
    expect(ledger.map((e) => e.kind)).toEqual(['payment', 'credit_sale']);
    const sale = ledger.find((e) => e.kind === 'credit_sale');
    expect(sale?.ref_id).toBe('s-1');
    expect(sale?.amount).toBe(70);              // SIGNED: +remaining (100 − 30)
    expect(sale?.receipt_no).not.toBeNull();    // receipt of the credit sale
    expect(sale?.applied_amount).toBeNull();
    const pmt = ledger.find((e) => e.kind === 'payment');
    expect(pmt?.amount).toBe(-20);              // SIGNED: −amount
    expect(pmt?.receipt_no).toBeNull();
    expect(pmt?.applied_amount).toBeNull();     // null until synced/capped
  });
});
