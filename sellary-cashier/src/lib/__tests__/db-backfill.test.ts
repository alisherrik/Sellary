import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function legacyPayload(items: { product_id: number; quantity: number; sell_price: number }[]) {
  return JSON.stringify({
    client_sale_id: 'x', idempotency_key: 'x', created_at_client: '2025-01-01T08:00:00.000Z',
    payment_method: 'CASH', card_type: null, discount_amount: 0, paid_amount: 0, change_amount: 0, items,
  });
}
async function seedOutbox(row: { client_sale_id: string; status: string; request_json: string; retry_count?: number }) {
  await fake.execute(
    `INSERT INTO outbox_sales (client_sale_id, idempotency_key, status, request_json, created_at_client, retry_count)
     VALUES ($1, $2, $3, $4, '2025-01-01T08:00:00.000Z', $5)`,
    [row.client_sale_id, `idem-${row.client_sale_id}`, row.status, row.request_json, row.retry_count ?? 0]
  );
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 100 });
  fake.seedProduct({ id: 2, stock_quantity: 100 });
  db = await import('../db');
});

describe('migrateOutboxToSalesOnce', () => {
  it('legacy pending/failed → stock_applied=0 then decremented by reconcile; legacy synced → stock_applied=1 (no double decrement)', async () => {
    await seedOutbox({ client_sale_id: 'pend', status: 'pending', request_json: legacyPayload([{ product_id: 1, quantity: 4, sell_price: 10 }]) });
    await seedOutbox({ client_sale_id: 'fail', status: 'failed', request_json: legacyPayload([{ product_id: 1, quantity: 3, sell_price: 10 }]) });
    await seedOutbox({ client_sale_id: 'sync', status: 'synced', request_json: legacyPayload([{ product_id: 2, quantity: 5, sell_price: 10 }]) });

    await db.migrateOutboxToSalesOnce();

    // pending(4) + failed(3) never applied historically → now decremented once each
    expect(fake.stockOf(1)).toBe(93); // 100 - 4 - 3
    // synced(5) already applied historically → NOT decremented again
    expect(fake.stockOf(2)).toBe(100);

    const pend = await db.getSaleWithItems((await db.getSalesHistory({ syncFilter: 'unsynced' })).find((s) => s.client_sale_id === 'pend')!.id);
    expect(pend?.sync_status).toBe('pending');
    expect(pend?.stock_applied).toBe(1); // applied by the reconcile the backfill runs
    const fail = (await db.getSalesHistory({ syncFilter: 'unsynced' })).find((s) => s.client_sale_id === 'fail');
    expect(fail?.error_kind).toBe('transient');
    const synced = (await db.getSalesHistory({ syncFilter: 'synced' })).find((s) => s.client_sale_id === 'sync');
    expect(synced?.stock_applied).toBe(1);
  });

  it('migrates syncing → failed+transient and lowercases payment method', async () => {
    await seedOutbox({ client_sale_id: 'insync', status: 'syncing', request_json: legacyPayload([{ product_id: 1, quantity: 2, sell_price: 10 }]) });
    await db.migrateOutboxToSalesOnce();
    const s = (await db.getSalesHistory({ syncFilter: 'unsynced' })).find((x) => x.client_sale_id === 'insync');
    expect(s?.sync_status).toBe('failed');
    expect(s?.error_kind).toBe('transient');
    expect(s?.payment_method).toBe('cash');
  });

  it('skips malformed request_json per-row (logs a sync_event) without aborting', async () => {
    await seedOutbox({ client_sale_id: 'bad', status: 'pending', request_json: '{not json' });
    await seedOutbox({ client_sale_id: 'good', status: 'pending', request_json: legacyPayload([{ product_id: 1, quantity: 1, sell_price: 10 }]) });
    await db.migrateOutboxToSalesOnce();
    const good = await db.getSalesHistory({ syncFilter: 'unsynced' });
    expect(good.map((s) => s.client_sale_id)).toContain('good');
    expect(good.map((s) => s.client_sale_id)).not.toContain('bad');
    const events = await fake.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM sync_events WHERE status = 'error'");
    expect(events[0].c).toBeGreaterThanOrEqual(1);
  });

  it('is a no-op on re-run (outbox_migrated_v2 flag)', async () => {
    await seedOutbox({ client_sale_id: 'one', status: 'pending', request_json: legacyPayload([{ product_id: 1, quantity: 6, sell_price: 10 }]) });
    await db.migrateOutboxToSalesOnce();
    expect(fake.stockOf(1)).toBe(94);
    await db.migrateOutboxToSalesOnce(); // guarded — must not re-copy or re-decrement
    expect(fake.stockOf(1)).toBe(94);
    const rows = await fake.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM sales');
    expect(rows[0].c).toBe(1);
    expect(await db.getMeta('outbox_migrated_v2')).toBe('1');
  });
});
