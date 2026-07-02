import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSaleSearchSuggestions, useSales } from '@/hooks/useQueries';
import SalesHistory from '../page';

const sale = {
  id: 42,
  customer_id: 3,
  customer_name: 'Фируз',
  cashier_id: 7,
  cashier_name: 'Мадина',
  subtotal: '33.00',
  tax_amount: '0.00',
  discount_amount: '0.00',
  total_amount: '33.00',
  refunded_amount: '0.00',
  remaining_refundable_amount: '33.00',
  payment_method: 'cash' as const,
  status: 'completed' as const,
  can_return: true,
  created_at: '2026-07-02T10:00:00Z',
  items: [],
};

vi.mock('@/hooks/useQueries', () => ({
  useSales: vi.fn(),
  useSaleSearchSuggestions: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  salesApi: {
    getReturns: vi.fn().mockResolvedValue({ data: [] }),
    previewVoid: vi.fn(),
    void: vi.fn(),
    processReturn: vi.fn(),
  },
  metaApi: { getSaleReturnOptions: vi.fn() },
  generateIdempotencyKey: vi.fn(() => 'search-test-key-1234'),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) =>
    selector({ currentCompany: { id: 1, role: 'admin' } }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/transactions/AnnulmentDialog', () => ({
  default: () => null,
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SalesHistory />
    </QueryClientProvider>,
  );
};

describe('Sales history smart search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSales).mockReturnValue({
      data: [sale],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    vi.mocked(useSaleSearchSuggestions).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
  });

  it('debounces a query and sends it to server search', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole('combobox', { name: 'Поиск продаж' }), 'колаа');

    await waitFor(
      () =>
        expect(useSales).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 200, search: 'колаа' }),
          expect.any(Object),
        ),
      { timeout: 1500 },
    );
  });

  it('combines return tab with server search params', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Возвраты' }));

    await waitFor(() =>
      expect(useSales).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 200, status_group: 'returns' }),
        expect.any(Object),
      ),
    );
  });

  it('uses a selected fuzzy suggestion as the canonical query', async () => {
    vi.mocked(useSaleSearchSuggestions).mockReturnValue({
      data: [{ kind: 'product', label: 'Кола', value: 'Кола', score: 89 }],
      isLoading: false,
    } as any);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole('combobox', { name: 'Поиск продаж' }), 'колаа');
    await user.click(await screen.findByRole('option', { name: /Кола/ }));

    await waitFor(
      () =>
        expect(useSales).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'Кола' }),
          expect.any(Object),
        ),
      { timeout: 1500 },
    );
  });
});
