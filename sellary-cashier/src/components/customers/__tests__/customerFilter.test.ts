import { describe, it, expect } from 'vitest';
import { debtCounts, filterCustomers, hasDebt } from '../customerFilter';
import type { CustomerWithBalance } from '../../../lib/db';

function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
  return {
    client_customer_id: over.client_customer_id ?? 'c1',
    server_id: over.server_id ?? null,
    name: over.name ?? 'Иван Петров',
    phone: over.phone ?? null,
    email: null,
    address: null,
    description: over.description ?? null,
    is_active: 1,
    sync_status: over.sync_status ?? 'synced',
    error_kind: over.error_kind ?? null,
    local_balance: over.local_balance ?? 0,
  };
}

describe('customerFilter', () => {
  it('hasDebt is true only for a positive local balance', () => {
    expect(hasDebt(cust({ local_balance: 100 }))).toBe(true);
    expect(hasDebt(cust({ local_balance: 0 }))).toBe(false);
    expect(hasDebt(cust({ local_balance: -50 }))).toBe(false);
  });

  it('debtCounts splits the list into all / debt / clear', () => {
    const list = [
      cust({ client_customer_id: 'a', local_balance: 500 }),
      cust({ client_customer_id: 'b', local_balance: 0 }),
      cust({ client_customer_id: 'c', local_balance: 1200 }),
    ];
    expect(debtCounts(list)).toEqual({ all: 3, debt: 2, clear: 1 });
  });

  it('filters by the debt tab', () => {
    const list = [
      cust({ client_customer_id: 'a', local_balance: 500 }),
      cust({ client_customer_id: 'b', local_balance: 0 }),
    ];
    expect(filterCustomers(list, 'debt', '').map((c) => c.client_customer_id)).toEqual(['a']);
    expect(filterCustomers(list, 'clear', '').map((c) => c.client_customer_id)).toEqual(['b']);
    expect(filterCustomers(list, 'all', '').map((c) => c.client_customer_id)).toEqual(['a', 'b']);
  });

  it('searches case-insensitively over name, phone and description', () => {
    const list = [
      cust({ client_customer_id: 'a', name: 'Иван Петров', phone: '901112233' }),
      cust({ client_customer_id: 'b', name: 'Ольга', description: 'магазин на углу' }),
    ];
    expect(filterCustomers(list, 'all', 'петров').map((c) => c.client_customer_id)).toEqual(['a']);
    expect(filterCustomers(list, 'all', '9011').map((c) => c.client_customer_id)).toEqual(['a']);
    expect(filterCustomers(list, 'all', 'УГЛУ').map((c) => c.client_customer_id)).toEqual(['b']);
    expect(filterCustomers(list, 'all', 'нет-такого')).toEqual([]);
  });
});
