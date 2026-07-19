import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../telegram/initData', () => ({
  getInitDataString: () => 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=test',
}));

import { shopFetch } from '../api';

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
