import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

// insertCustomerPayment now generates the id + created_at_client (contract C-3), so capture the
// returned id and stamp a deterministic created_at_client via raw SQL for ordering assertions.
async function pay(amount: number, when: string): Promise<string> {
  const { clientPaymentId } = await db.insertCustomerPayment({
    customer_client_id: 'cust-1', amount, payment_method: 'cash',
  });
  await fake.execute(
    'UPDATE customer_payments SET created_at_client = $1 WHERE client_payment_id = $2',
    [when, clientPaymentId]
  );
  return clientPaymentId;
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  db = await import('../db');
});

describe('payment sync-worker DAOs', () => {
  it('getSendablePayments returns pending oldest-first; excludes future/permanent', async () => {
    const p2 = await pay(20, '2025-01-01T09:00:00.000Z');
    const p1 = await pay(10, '2025-01-01T08:00:00.000Z');
    const fut = await pay(30, '2025-01-01T07:00:00.000Z');
    const perm = await pay(40, '2025-01-01T06:00:00.000Z');
    await db.markPaymentTransientFailure([fut], '2025-01-01T23:00:00.000Z', 'net');
    await db.markPaymentPermanentFailure(perm, 'no customer');
    const sendable = await db.getSendablePayments('2025-01-01T10:00:00.000Z');
    expect(sendable.map((p) => p.client_payment_id)).toEqual([p1, p2]);
  });

  it('getSendablePayments with includePermanent also returns permanent failures', async () => {
    const p1 = await pay(10, '2025-01-01T08:00:00.000Z');
    const perm = await pay(40, '2025-01-01T06:00:00.000Z');
    await db.markPaymentPermanentFailure(perm, 'no customer');
    const forced = await db.getSendablePayments('2025-01-01T10:00:00.000Z', { includePermanent: true });
    expect(forced.map((p) => p.client_payment_id).sort()).toEqual([p1, perm].sort());
  });

  it('recoverSyncingPayments moves syncing → failed+transient and returns the count', async () => {
    const p1 = await pay(10, '2025-01-01T08:00:00.000Z');
    await db.markPaymentSyncing(p1);
    const n = await db.recoverSyncingPayments('2025-01-01T10:00:00.000Z');
    expect(n).toBe(1);
    const rows = await db.getSendablePayments('2025-01-01T10:00:00.000Z');
    expect(rows[0].error_kind).toBe('transient');
    expect(rows[0].next_attempt_at).toBe('2025-01-01T10:00:00.000Z');
  });

  it('getUnsyncedPaymentCount counts pending+syncing+transient, excludes permanent', async () => {
    await pay(10, '2025-01-01T08:00:00.000Z');            // pending
    const trans = await pay(20, '2025-01-01T08:00:00.000Z');
    const perm = await pay(30, '2025-01-01T08:00:00.000Z');
    await db.markPaymentTransientFailure([trans], '2025-01-01T07:00:00.000Z', 'net');
    await db.markPaymentPermanentFailure(perm, 'no customer');
    expect(await db.getUnsyncedPaymentCount()).toBe(2);
  });

  it('applyPaymentResults sets applied_amount + marks synced (capped amount preserved)', async () => {
    const p1 = await pay(100, '2025-01-01T08:00:00.000Z');   // requested 100
    const p2 = await pay(50, '2025-01-01T08:30:00.000Z');
    // Inline literals structurally match SyncPaymentResult (api.ts, contract C-7).
    await db.applyPaymentResults([
      { client_payment_id: p1, status: 'synced', applied_amount: 70 },   // capped-to-balance
      { client_payment_id: p2, status: 'duplicate', applied_amount: 50 },
    ]);
    const rows = await fake.select<import('../db').LocalCustomerPayment[]>(
      'SELECT * FROM customer_payments');
    expect(rows.find((r) => r.client_payment_id === p1)?.sync_status).toBe('synced');
    expect(rows.find((r) => r.client_payment_id === p1)?.applied_amount).toBe(70);
    expect(rows.find((r) => r.client_payment_id === p2)?.sync_status).toBe('synced');
    expect(rows.find((r) => r.client_payment_id === p2)?.applied_amount).toBe(50);
  });
});

describe('combined credit outbox counts (contract C-5)', () => {
  it('getUnsyncedCreditCount sums pending+syncing+transient across customers + payments', async () => {
    await db.insertCustomer({ name: 'A', phone: '1' });                    // pending customer (+1)
    await pay(10, '2025-01-01T08:00:00.000Z');                             // pending payment (+1)
    const trans = await pay(20, '2025-01-01T08:00:00.000Z');
    await db.markPaymentTransientFailure([trans], '2025-01-01T07:00:00.000Z', 'net'); // transient payment (+1)
    const permC = (await db.insertCustomer({ name: 'B', phone: '2' })).clientCustomerId;
    await db.markCustomerPermanentFailure(permC, 'dup');                   // permanent customer (excluded)
    expect(await db.getUnsyncedCreditCount()).toBe(3);                     // 1 customer + 2 payments
  });

  it('getNeedsAttentionCreditCount counts permanent failures across customers + payments', async () => {
    const permC = (await db.insertCustomer({ name: 'B', phone: '2' })).clientCustomerId;
    await db.markCustomerPermanentFailure(permC, 'dup');                   // permanent customer (+1)
    const permP = await pay(40, '2025-01-01T06:00:00.000Z');
    await db.markPaymentPermanentFailure(permP, 'no customer');            // permanent payment (+1)
    await pay(10, '2025-01-01T08:00:00.000Z');                             // pending payment (excluded)
    expect(await db.getNeedsAttentionCreditCount()).toBe(2);              // 1 customer + 1 payment
  });
});
