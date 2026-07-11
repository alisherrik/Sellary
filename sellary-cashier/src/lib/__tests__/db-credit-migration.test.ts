import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;

beforeEach(() => {
  fake = createTestDb();
});

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

describe('migration 003 — offline credit schema', () => {
  it('creates the customers table with the spec columns', async () => {
    const cols = await fake.select<ColumnInfo[]>('PRAGMA table_info(customers)');
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of [
      'client_customer_id', 'server_id', 'name', 'phone', 'email', 'address',
      'description', 'balance', 'is_active', 'sync_status', 'error_kind',
      'next_attempt_at', 'first_failed_at', 'last_error', 'retry_count',
      'created_at_client', 'synced_at', 'updated_at',
    ]) {
      expect(byName.has(name), `missing customers.${name}`).toBe(true);
    }
    expect(byName.get('client_customer_id')?.pk).toBe(1);
  });

  it('creates the customer_payments outbox table with the spec columns', async () => {
    const cols = await fake.select<ColumnInfo[]>('PRAGMA table_info(customer_payments)');
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of [
      'client_payment_id', 'idempotency_key', 'customer_client_id', 'amount',
      'payment_method', 'description', 'applied_amount', 'server_customer_id',
      'sync_status', 'error_kind', 'next_attempt_at', 'first_failed_at',
      'last_error', 'retry_count', 'created_at_client', 'synced_at',
    ]) {
      expect(byName.has(name), `missing customer_payments.${name}`).toBe(true);
    }
    expect(byName.get('client_payment_id')?.pk).toBe(1);
  });

  it('adds customer_client_id + initial_payment_method to sales', async () => {
    const cols = await fake.select<ColumnInfo[]>('PRAGMA table_info(sales)');
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('customer_client_id')).toBe(true);
    expect(names.has('initial_payment_method')).toBe(true);
  });
});
