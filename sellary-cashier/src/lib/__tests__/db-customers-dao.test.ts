import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  db = await import('../db');
});

describe('customers DAO', () => {
  it('insertCustomer generates a client id + timestamp and stores a pending, active row with balance 0', async () => {
    const { clientCustomerId } = await db.insertCustomer({ name: 'Ivan', phone: '+992900000001' });
    expect(clientCustomerId).toBeTruthy();          // db-generated uuid
    const row = await db.getCustomerByClientId(clientCustomerId);
    expect(row?.name).toBe('Ivan');
    expect(row?.phone).toBe('+992900000001');
    expect(row?.server_id).toBeNull();
    expect(row?.balance).toBe(0);
    expect(row?.is_active).toBe(1);
    expect(row?.sync_status).toBe('pending');
    expect(row?.retry_count).toBe(0);
    expect(row?.created_at_client).toBeTruthy();     // db-generated ISO timestamp
  });

  it('insertCustomer defaults optional fields to NULL', async () => {
    const { clientCustomerId } = await db.insertCustomer({ name: 'Solo' });
    const row = await db.getCustomerByClientId(clientCustomerId);
    expect(row?.phone).toBeNull();
    expect(row?.email).toBeNull();
    expect(row?.address).toBeNull();
    expect(row?.description).toBeNull();
  });

  it('getCustomerByClientId returns null for an unknown id', async () => {
    expect(await db.getCustomerByClientId('missing')).toBeNull();
  });

  it('getCustomers lists active customers alphabetically', async () => {
    await db.insertCustomer({ name: 'Boris', phone: '2' });
    await db.insertCustomer({ name: 'Anna', phone: '1' });
    const rows = await db.getCustomers();
    expect(rows.map((r) => r.name)).toEqual(['Anna', 'Boris']);
  });

  it('getCustomers filters by search on name or phone', async () => {
    await db.insertCustomer({ name: 'Anna', phone: '111' });
    await db.insertCustomer({ name: 'Boris', phone: '222' });
    expect((await db.getCustomers({ search: 'nna' })).map((r) => r.name)).toEqual(['Anna']);
    expect((await db.getCustomers({ search: '222' })).map((r) => r.name)).toEqual(['Boris']);
  });
});
