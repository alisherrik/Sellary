import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushCustomers, pushPayments, fetchBootstrap, setApiBaseUrl, setAccessToken } from '../api';

describe('sync credit api', () => {
  beforeEach(async () => {
    await setApiBaseUrl('http://127.0.0.1:8001');
    setAccessToken('bearer-xyz');
    vi.restoreAllMocks();
  });

  it('pushCustomers POSTs { customers } to /api/sync/customers with the bearer and parses results', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [{ client_customer_id: 'c1', status: 'synced', server_id: 55 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await pushCustomers([
      { client_customer_id: 'c1', name: 'Иван', phone: null, email: null, address: null, description: null },
    ]);

    expect(res.results[0]).toEqual({ client_customer_id: 'c1', status: 'synced', server_id: 55 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/sync/customers');
    expect(JSON.parse(init.body)).toEqual({
      customers: [{ client_customer_id: 'c1', name: 'Иван', phone: null, email: null, address: null, description: null }],
    });
    expect(init.headers.Authorization).toBe('Bearer bearer-xyz');
  });

  it('pushPayments POSTs { payments } to /api/sync/payments and coerces Decimal JSON-strings to numbers', async () => {
    // Contract §C-8: the backend serializes Decimal as JSON strings ("30.00"); api.ts must coerce
    // applied_amount + warning requested/applied to real numbers before the engine sees them.
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        results: [
          {
            client_payment_id: 'p1',
            status: 'synced',
            applied_amount: '30.00',
            warnings: [{ type: 'overpayment', requested: '50.00', applied: '30.00' }],
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await pushPayments([
      { client_payment_id: 'p1', idempotency_key: 'idem-p1', client_customer_id: 'c1', amount: 50, payment_method: 'cash', description: null },
    ]);

    // Coerced: string '30.00' -> number 30 (strict identity, not just deep-equal).
    expect(res.results[0].applied_amount).toBe(30);
    expect(typeof res.results[0].applied_amount).toBe('number');
    expect(res.results[0].warnings?.[0]).toEqual({ type: 'overpayment', requested: 50, applied: 30 });
    expect(typeof res.results[0].warnings?.[0].requested).toBe('number');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/sync/payments');
    expect(JSON.parse(init.body)).toEqual({
      payments: [{ client_payment_id: 'p1', idempotency_key: 'idem-p1', client_customer_id: 'c1', amount: 50, payment_method: 'cash', description: null }],
    });
  });

  it('fetchBootstrap coerces customer balance Decimal JSON-strings to numbers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        company_id: 1,
        company_name: 'Acme',
        user_id: 1,
        user_username: 'u',
        user_role: 'cashier',
        server_time: '2026-07-11T00:00:00.000Z',
        products: [],
        categories: [],
        customers: [
          { id: 1, client_customer_id: 'srv:1', name: 'Иван', phone: null, email: null, address: null, description: null, balance: '30.00', is_active: true },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchBootstrap();

    // Coerced: string '30.00' -> number 30.
    expect(res.customers[0].balance).toBe(30);
    expect(typeof res.customers[0].balance).toBe('number');
  });
});
