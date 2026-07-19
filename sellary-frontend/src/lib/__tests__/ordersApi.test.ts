import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get,
      post,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));

// Deterministic idempotency key.
let ordersApi: typeof import('@/lib/api')['ordersApi'];

beforeEach(async () => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { items: [], total: 0, skip: 0, limit: 20 } });
  post.mockResolvedValue({ data: {} });
  ordersApi = (await import('@/lib/api')).ordersApi;
});

describe('ordersApi', () => {
  it('lists with a status filter', async () => {
    await ordersApi.list({ status: 'pending' });
    expect(get).toHaveBeenCalledWith('/orders', { params: { status: 'pending' } });
  });

  it('lists without a status filter (all)', async () => {
    await ordersApi.list();
    expect(get).toHaveBeenCalledWith('/orders', { params: undefined });
  });

  it('gets a single order', async () => {
    await ordersApi.getById(7);
    expect(get).toHaveBeenCalledWith('/orders/7');
  });

  it('confirms with an Idempotency-Key header and default cash payment', async () => {
    await ordersApi.confirm(7);
    expect(post).toHaveBeenCalledWith(
      '/orders/7/confirm',
      { payment_method: 'cash' },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    );
  });

  it('reuses a supplied Idempotency-Key on confirm retry', async () => {
    await ordersApi.confirm(7, 'cash', 'fixed-key-123');
    expect(post).toHaveBeenCalledWith(
      '/orders/7/confirm',
      { payment_method: 'cash' },
      { headers: { 'Idempotency-Key': 'fixed-key-123' } },
    );
  });

  it('advances status', async () => {
    await ordersApi.advanceStatus(7, 'preparing');
    expect(post).toHaveBeenCalledWith('/orders/7/status', { status: 'preparing' });
  });

  it('cancels with a reason', async () => {
    await ordersApi.cancel(7, 'Нет в наличии');
    expect(post).toHaveBeenCalledWith('/orders/7/cancel', { reason: 'Нет в наличии' });
  });
});
