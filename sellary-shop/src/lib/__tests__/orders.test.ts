import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../telegram/initData', () => ({
  getInitDataString: () => 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=test',
}));

import { getMyOrders, getMyOrder, normalizeOrder } from '../api';
import type { ShopOrder } from '../../types';

const rawOrder = {
  id: 5,
  company_id: 1,
  order_number: 42,
  status: 'confirmed',
  fulfillment_type: 'pickup',
  delivery_address: null,
  contact_phone: '+99290000000',
  contact_name: 'Тест',
  subtotal: '10000.00',
  total_amount: '10000.00',
  notes: null,
  sale_id: null,
  checkout_group_id: 'abc',
  created_at: '2026-07-20T10:00:00',
  updated_at: '2026-07-20T10:00:00',
  items: [
    { id: 1, product_id: 10, product_name: 'Молоко', unit_price: '5000.00', quantity: '2.000', line_total: '10000.00' },
  ],
} as unknown as ShopOrder;

describe('normalizeOrder', () => {
  it('coerces Decimal-string money/quantity to numbers', () => {
    const o = normalizeOrder(rawOrder);
    expect(o.total_amount).toBe(10000);
    expect(o.subtotal).toBe(10000);
    expect(o.items[0].unit_price).toBe(5000);
    expect(o.items[0].quantity).toBe(2);
    expect(o.items[0].line_total).toBe(10000);
  });
});

describe('getMyOrders', () => {
  beforeEach(() => mockFetch.mockReset());

  it('GETs /api/shop/orders and normalizes items', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [rawOrder], total: 1, skip: 0, limit: 20 }),
    } as Response);

    const page = await getMyOrders();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/shop/orders');
    expect(init.method ?? 'GET').toBe('GET');
    expect(page.items[0].total_amount).toBe(10000);
    expect(typeof page.items[0].items[0].quantity).toBe('number');
  });

  it('sends X-Telegram-Init-Data header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], total: 0, skip: 0, limit: 20 }),
    } as Response);

    await getMyOrders();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('X-Telegram-Init-Data')).toBeTruthy();
  });
});

describe('getMyOrder', () => {
  beforeEach(() => mockFetch.mockReset());

  it('GETs /api/shop/orders/{id} and normalizes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => rawOrder,
    } as Response);

    const o = await getMyOrder(5);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/shop/orders/5');
    expect(o.order_number).toBe(42);
    expect(o.total_amount).toBe(10000);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(getMyOrder(999)).rejects.toThrow('404');
  });
});
