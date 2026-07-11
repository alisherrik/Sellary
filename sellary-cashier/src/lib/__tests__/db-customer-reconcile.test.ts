import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

function server(over: Partial<import('../db').ServerCustomerItem> = {}): import('../db').ServerCustomerItem {
  return {
    id: over.id ?? 10,
    client_customer_id: over.client_customer_id ?? null,
    name: over.name ?? 'Ivan',
    phone: over.phone ?? '+992900000001',
    email: over.email ?? null,
    address: over.address ?? null,
    description: over.description ?? null,
    balance: over.balance ?? 0,
    is_active: over.is_active ?? true,
  };
}

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  fake.seedProduct({ id: 1, stock_quantity: 1000 });
  db = await import('../db');
});

describe('bootstrap upsert + reconcile', () => {
  it('upsertServerCustomers inserts a synced row keyed by srv:<id> when no client id', async () => {
    await db.upsertServerCustomers([server({ id: 10, balance: 150 })]);
    const row = await db.getCustomerByClientId('srv:10');
    expect(row?.server_id).toBe(10);
    expect(row?.balance).toBe(150);
    expect(row?.sync_status).toBe('synced');
    expect(row?.is_active).toBe(1);
  });

  it('upsertServerCustomers reuses the offline client id when the server echoes it', async () => {
    const { clientCustomerId } = await db.insertCustomer({ name: 'Ivan', phone: '1' });
    await db.upsertServerCustomers([server({ id: 42, client_customer_id: clientCustomerId, balance: 90 })]);
    const rows = await db.getCustomers();
    expect(rows).toHaveLength(1);               // merged, not duplicated
    expect(rows[0].client_customer_id).toBe(clientCustomerId);
    expect(rows[0].server_id).toBe(42);
    expect(rows[0].balance).toBe(90);
    expect(rows[0].sync_status).toBe('synced');
  });

  it('reconcileCustomerBalances overwrites raw balance and is idempotent under unsynced deltas', async () => {
    await db.upsertServerCustomers([server({ id: 10, balance: 100 })]);
    // Add an unsynced payment of 30 for this pulled customer.
    await db.insertCustomerPayment({ customer_client_id: 'srv:10', amount: 30, payment_method: 'cash' });
    expect(await db.getCustomerLocalBalance('srv:10')).toBe(70);     // 100 − 30
    // Reconcile with the same raw server balance twice — derived balance must not drift.
    await db.reconcileCustomerBalances([server({ id: 10, balance: 100 })]);
    await db.reconcileCustomerBalances([server({ id: 10, balance: 100 })]);
    expect(await db.getCustomerLocalBalance('srv:10')).toBe(70);     // still 100 − 30
    // A new raw server balance is adopted verbatim.
    await db.reconcileCustomerBalances([server({ id: 10, balance: 40 })]);
    expect(await db.getCustomerLocalBalance('srv:10')).toBe(10);     // 40 − 30
  });
});
