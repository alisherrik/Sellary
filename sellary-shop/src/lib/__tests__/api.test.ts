import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../telegram/initData', () => ({
  getInitDataString: () => 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=test',
}));

import { shopFetch, normalizeProduct, normalizeCatalogPage } from '../api';

describe('shopFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends X-Telegram-Init-Data header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);

    await shopFetch('/api/shop/catalog');

    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('X-Telegram-Init-Data')).toBe('auth_date=1&user=%7B%22id%22%3A1%7D&hash=test');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(shopFetch('/api/shop/catalog')).rejects.toThrow('404');
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [1, 2] }),
    } as Response);

    const result = await shopFetch<{ items: number[] }>('/api/shop/catalog');
    expect(result.items).toEqual([1, 2]);
  });
});

describe('normalizeProduct (Fix 1 — string sell_price coercion)', () => {
  it('coerces string sell_price to number', () => {
    const raw = {
      id: 1, name: 'Молоко', description: null, sell_price: '12000.00' as unknown as number,
      image_url: null, uom: 'шт', category_id: null, category_name: null,
      company_id: 1, company_name: 'Test', company_slug: 'test', in_stock: true,
    };
    const norm = normalizeProduct(raw);
    expect(typeof norm.sell_price).toBe('number');
    expect(norm.sell_price).toBe(12000);
  });

  it('leaves numeric sell_price unchanged', () => {
    const raw = {
      id: 2, name: 'Хлеб', description: null, sell_price: 5000,
      image_url: null, uom: 'шт', category_id: null, category_name: null,
      company_id: 1, company_name: 'Test', company_slug: 'test', in_stock: true,
    };
    const norm = normalizeProduct(raw);
    expect(norm.sell_price).toBe(5000);
  });

  it('normalizeCatalogPage coerces all items', () => {
    const page = {
      items: [
        {
          id: 1, name: 'A', description: null, sell_price: '999.50' as unknown as number,
          image_url: null, uom: 'шт', category_id: null, category_name: null,
          company_id: 1, company_name: 'T', company_slug: 't', in_stock: true,
        },
        {
          id: 2, name: 'B', description: null, sell_price: '100.00' as unknown as number,
          image_url: null, uom: 'шт', category_id: null, category_name: null,
          company_id: 1, company_name: 'T', company_slug: 't', in_stock: true,
        },
      ],
      total: 2, skip: 0, limit: 24,
    };
    const norm = normalizeCatalogPage(page);
    expect(norm.items[0].sell_price).toBe(999.5);
    expect(norm.items[1].sell_price).toBe(100);
    norm.items.forEach(p => expect(typeof p.sell_price).toBe('number'));
  });
});
