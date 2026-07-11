import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

// insertCustomer now generates the id + created_at_client (contract C-2), so we capture the
// returned id and stamp a deterministic created_at_client via raw SQL for ordering assertions.
async function newCustomer(name: string, when: string): Promise<string> {
  const { clientCustomerId } = await db.insertCustomer({ name, phone: name });
  await fake.execute(
    'UPDATE customers SET created_at_client = $1 WHERE client_customer_id = $2',
    [when, clientCustomerId]
  );
  return clientCustomerId;
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  db = await import('../db');
});

describe('customer sync-worker DAOs', () => {
  it('getSendableCustomers returns pending oldest-first; excludes future/permanent', async () => {
    const c2 = await newCustomer('B', '2025-01-01T09:00:00.000Z');
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    const fut = await newCustomer('F', '2025-01-01T07:00:00.000Z');
    const perm = await newCustomer('P', '2025-01-01T06:00:00.000Z');
    await db.markCustomerTransientFailure([fut], '2025-01-01T23:00:00.000Z', 'net');
    await db.markCustomerPermanentFailure(perm, 'dup');
    const sendable = await db.getSendableCustomers('2025-01-01T10:00:00.000Z');
    expect(sendable.map((c) => c.client_customer_id)).toEqual([c1, c2]);
  });

  it('getSendableCustomers with includePermanent also returns permanent failures', async () => {
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    const perm = await newCustomer('P', '2025-01-01T06:00:00.000Z');
    await db.markCustomerPermanentFailure(perm, 'dup');
    const forced = await db.getSendableCustomers('2025-01-01T10:00:00.000Z', { includePermanent: true });
    expect(forced.map((c) => c.client_customer_id).sort()).toEqual([c1, perm].sort());
  });

  it('markCustomerSyncing → recoverSyncingCustomers moves back to failed+transient', async () => {
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    await db.markCustomerSyncing(c1);
    expect((await db.getCustomerByClientId(c1))?.sync_status).toBe('syncing');
    const n = await db.recoverSyncingCustomers('2025-01-01T10:00:00.000Z');
    expect(n).toBe(1);
    const row = await db.getCustomerByClientId(c1);
    expect(row?.sync_status).toBe('failed');
    expect(row?.error_kind).toBe('transient');
    expect(row?.next_attempt_at).toBe('2025-01-01T10:00:00.000Z');
  });

  it('getUnsyncedCustomerCount counts pending+syncing+transient, excludes permanent', async () => {
    await newCustomer('A', '2025-01-01T08:00:00.000Z');            // pending
    const trans = await newCustomer('B', '2025-01-01T08:00:00.000Z');
    const perm = await newCustomer('C', '2025-01-01T08:00:00.000Z');
    await db.markCustomerTransientFailure([trans], '2025-01-01T07:00:00.000Z', 'net');
    await db.markCustomerPermanentFailure(perm, 'dup');
    expect(await db.getUnsyncedCustomerCount()).toBe(2);
  });

  it('applyCustomerIdMap sets server_id + marks synced for synced/duplicate results', async () => {
    const c1 = await newCustomer('A', '2025-01-01T08:00:00.000Z');
    const c2 = await newCustomer('B', '2025-01-01T08:00:00.000Z');
    const c3 = await newCustomer('C', '2025-01-01T08:00:00.000Z');
    // Inline literals structurally match SyncCustomerResult (api.ts, contract C-7).
    await db.applyCustomerIdMap([
      { client_customer_id: c1, status: 'synced', server_id: 501 },
      { client_customer_id: c2, status: 'duplicate', server_id: 502 },
      { client_customer_id: c3, status: 'failed', server_id: null, error: 'boom' },
    ]);
    expect((await db.getCustomerByClientId(c1))?.server_id).toBe(501);
    expect((await db.getCustomerByClientId(c1))?.sync_status).toBe('synced');
    expect((await db.getCustomerByClientId(c2))?.server_id).toBe(502);
    expect((await db.getCustomerByClientId(c2))?.sync_status).toBe('synced');
    expect((await db.getCustomerByClientId(c3))?.server_id).toBeNull();
    expect((await db.getCustomerByClientId(c3))?.sync_status).toBe('pending'); // failed left for the engine
  });
});
