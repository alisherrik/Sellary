import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function input(over: Partial<import('../db').NewSaleInput> = {}): import('../db').NewSaleInput {
  return {
    client_sale_id: over.client_sale_id ?? 'c-1',
    idempotency_key: over.idempotency_key ?? 'i-1',
    subtotal: 10, discount_amount: 0, tax_amount: 0, total_amount: 10,
    paid_amount: 10, change_amount: 0, payment_method: 'cash', card_type: null,
    notes: null, cashier_user_id: 1, cashier_username: 'k',
    created_at_client: over.created_at_client ?? '2025-01-01T08:00:00.000Z',
    items: over.items ?? [
      { product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 2,
        unit_price: 5, tax_percent: 0, line_subtotal: 10, line_total: 10, sort_order: 0 },
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  fake.seedProduct({ id: 2, stock_quantity: 100 });
  db = await import('../db');
});

describe('sync-worker DAOs', () => {
  it('getSendableSales returns pending oldest-first and rebuilds items', async () => {
    await db.insertSale(input({ client_sale_id: 'c-2', idempotency_key: 'i-2', created_at_client: '2025-01-01T09:00:00.000Z' }));
    await db.insertSale(input({ client_sale_id: 'c-1', idempotency_key: 'i-1', created_at_client: '2025-01-01T08:00:00.000Z' }));
    const sendable = await db.getSendableSales('2025-01-01T10:00:00.000Z');
    expect(sendable.map((s) => s.client_sale_id)).toEqual(['c-1', 'c-2']);
    expect(sendable[0].items).toHaveLength(1);
    expect(sendable[0].items[0].quantity).toBe(2);
  });

  it('getSendableSales includes due transient failures and excludes future/permanent', async () => {
    const { saleId: due } = await db.insertSale(input({ client_sale_id: 'due', idempotency_key: 'd' }));
    const { saleId: future } = await db.insertSale(input({ client_sale_id: 'fut', idempotency_key: 'f' }));
    const { saleId: perm } = await db.insertSale(input({ client_sale_id: 'perm', idempotency_key: 'p' }));
    await db.markTransientFailure([due], '2025-01-01T07:00:00.000Z', 'net');
    await db.markTransientFailure([future], '2025-01-01T23:00:00.000Z', 'net');
    await db.markPermanentFailure(perm, 'Products not found');
    const sendable = await db.getSendableSales('2025-01-01T10:00:00.000Z');
    expect(sendable.map((s) => s.client_sale_id)).toEqual(['due']);
  });

  it('getSendableSales with includePermanent also returns permanent failures (force resend)', async () => {
    const { saleId: due } = await db.insertSale(input({ client_sale_id: 'due', idempotency_key: 'd' }));
    const { saleId: perm } = await db.insertSale(input({ client_sale_id: 'perm', idempotency_key: 'p' }));
    await db.markTransientFailure([due], '2025-01-01T07:00:00.000Z', 'net');
    await db.markPermanentFailure(perm, 'Products not found');
    const forced = await db.getSendableSales('2025-01-01T10:00:00.000Z', { includePermanent: true });
    expect(forced.map((s) => s.client_sale_id).sort()).toEqual(['due', 'perm']);
  });

  it('markSaleSyncing / markSaleSynced move a sale to terminal synced', async () => {
    const { saleId } = await db.insertSale(input());
    await db.markSaleSyncing(saleId);
    let s = await db.getSaleWithItems(saleId);
    expect(s?.sync_status).toBe('syncing');
    await db.markSaleSynced(saleId, 555);
    s = await db.getSaleWithItems(saleId);
    expect(s?.sync_status).toBe('synced');
    expect(s?.server_sale_id).toBe(555);
    expect(s?.synced_at).not.toBeNull();
  });

  it('recoverSyncingSales moves syncing → failed+transient and returns the count', async () => {
    const { saleId } = await db.insertSale(input());
    await db.markSaleSyncing(saleId);
    const n = await db.recoverSyncingSales('2025-01-01T10:00:00.000Z');
    expect(n).toBe(1);
    const s = await db.getSaleWithItems(saleId);
    expect(s?.sync_status).toBe('failed');
    expect(s?.error_kind).toBe('transient');
    expect(s?.next_attempt_at).toBe('2025-01-01T10:00:00.000Z');
  });

  it('counts: unsynced excludes permanent; needs-attention counts only permanent', async () => {
    const { saleId: t } = await db.insertSale(input({ client_sale_id: 't', idempotency_key: 't' }));
    const { saleId: p } = await db.insertSale(input({ client_sale_id: 'p', idempotency_key: 'p' }));
    await db.insertSale(input({ client_sale_id: 'pending', idempotency_key: 'pe' })); // pending
    await db.markTransientFailure([t], '2025-01-01T07:00:00.000Z', 'net');
    await db.markPermanentFailure(p, 'boom');
    expect(await db.getUnsyncedCount()).toBe(2);        // pending + transient-failed
    expect(await db.getNeedsAttentionCount()).toBe(1);  // permanent only
  });

  it('acknowledgeSale drops a permanent failure from needs-attention but keeps the row', async () => {
    const { saleId: p } = await db.insertSale(input({ client_sale_id: 'p', idempotency_key: 'p' }));
    await db.markPermanentFailure(p, 'boom');
    expect(await db.getNeedsAttentionCount()).toBe(1);
    await db.acknowledgeSale(p);
    expect(await db.getNeedsAttentionCount()).toBe(0);   // acknowledged → out of the count
    const s = await db.getSaleWithItems(p);
    expect(s?.acknowledged).toBe(1);                     // row kept
    expect(s?.sync_status).toBe('failed');               // still failed, never blocks logout
  });

  it('getUnsyncedBaseQtyByProduct sums base qty over ALL non-synced sales (incl. permanent)', async () => {
    const { saleId: p } = await db.insertSale(input({
      client_sale_id: 'a', idempotency_key: 'a',
      items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 4, unit_price: 5, tax_percent: 0, line_subtotal: 20, line_total: 20, sort_order: 0 }],
    }));
    const { saleId: syncedId } = await db.insertSale(input({
      client_sale_id: 'b', idempotency_key: 'b',
      items: [{ product_id: 1, product_name: 'A', barcode: null, uom: 'pcs', quantity: 3, unit_price: 5, tax_percent: 0, line_subtotal: 15, line_total: 15, sort_order: 0 }],
    }));
    await db.markPermanentFailure(p, 'boom');       // still counts toward unsynced qty
    await db.markSaleSynced(syncedId, 1);           // synced → excluded
    const map = await db.getUnsyncedBaseQtyByProduct();
    expect(map.get(1)).toBe(4);
    expect(map.get(2)).toBeUndefined();
  });
});
