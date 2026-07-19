import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { useOrders, useOrder, queryKeys } from '@/hooks/useQueries';
import { ordersApi } from '@/lib/api';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => selector({ currentCompany: { id: 1, role: 'admin' } }),
}));
vi.mock('@/lib/api', () => ({
  ordersApi: { list: vi.fn(), getById: vi.fn() },
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => vi.clearAllMocks());

describe('useOrders / useOrder', () => {
  it('fetches the order list with a status filter', async () => {
    vi.mocked(ordersApi.list).mockResolvedValue({
      data: { items: [{ id: 1, order_number: 42, status: 'pending' }], total: 1, skip: 0, limit: 20 },
    } as never);

    const { result } = renderHook(() => useOrders({ status: 'pending' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ordersApi.list).toHaveBeenCalledWith({ status: 'pending' });
    expect(result.current.data?.items).toHaveLength(1);
  });

  it('fetches a single order detail', async () => {
    vi.mocked(ordersApi.getById).mockResolvedValue({
      data: { id: 7, order_number: 7, status: 'confirmed' },
    } as never);

    const { result } = renderHook(() => useOrder(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ordersApi.getById).toHaveBeenCalledWith(7);
  });

  it('builds tenant-scoped query keys', () => {
    expect(queryKeys.orders(1, { status: 'pending' })[0]).toBe('orders');
    expect(queryKeys.order(1, 7)).toEqual(['order', 1, 7]);
  });
});
