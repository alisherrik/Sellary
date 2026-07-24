import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInfiniteSales, useSalesSummary, useSaleSearchSuggestions } from '@/hooks/useQueries';
import { salesApi, metaApi } from '@/lib/api';
import SalesHistory from '../page';

vi.mock('@/hooks/useQueries', () => ({
  useInfiniteSales: vi.fn(),
  useSalesSummary: vi.fn(),
  useSaleSearchSuggestions: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  customersApi: { recordPayment: vi.fn() },
  salesApi: {
    getReturns: vi.fn().mockResolvedValue({ data: [] }),
    previewVoid: vi.fn(),
    void: vi.fn(),
    processReturn: vi.fn().mockResolvedValue({ data: {} }),
  },
  metaApi: {
    getSaleReturnOptions: vi.fn().mockResolvedValue({ data: { refund_methods: ['cash', 'card'] } }),
  },
  generateIdempotencyKey: vi.fn(() => 'annul-key-0001'),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => selector({ currentCompany: { id: 1, role: 'admin' } }),
  useModules: () => ({ pos: 'user' }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/transactions/AnnulmentDialog', () => ({ default: () => null }));

const saleWithItems = {
  id: 42,
  customer_id: 3,
  customer_name: 'Фируз',
  cashier_id: 7,
  cashier_name: 'Мадина',
  subtotal: '50.00',
  tax_amount: '0.00',
  discount_amount: '0.00',
  total_amount: '50.00',
  refunded_amount: '0.00',
  remaining_refundable_amount: '50.00',
  payment_method: 'cash' as const,
  status: 'completed' as const,
  can_return: true,
  created_at: '2026-07-02T10:00:00Z',
  items: [
    {
      id: 8001,
      product_id: 90,
      product_name: 'Сахар 1кг',
      uom: 'шт',
      quantity: 2,
      quantity_returned: 0,
      quantity_returnable: 2,
      unit_price: '25.00',
      total: '50.00',
      transaction_type: 'sale',
      can_return: true,
    },
  ],
};

const infiniteResult = () => ({
  sales: [saleWithItems],
  total: 1,
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
  hasMore: false,
  loadMore: vi.fn(),
  refetch: vi.fn(),
});

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

describe('Sales line-level annulment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useInfiniteSales).mockReturnValue(infiniteResult() as any);
    vi.mocked(useSalesSummary).mockReturnValue({
      data: {
        turnover: '33.00',
        refunds: '0.00',
        net_turnover: '33.00',
        count: 1,
        average_check: '33.00',
        refund_operations: 0,
        hourly: [],
      },
      isLoading: false,
    } as any);
    vi.mocked(useSaleSearchSuggestions).mockReturnValue({ data: [], isLoading: false } as any);
  });

  it('opens the return modal preselected for one line, fixed to its full quantity, and submits an annulment', async () => {
    const user = userEvent.setup();
    renderPage();

    // Open the sale detail (the mobile list button carries the sale number).
    await user.click(screen.getAllByText('#42')[0]);

    // The per-line annul action appears for the admin.
    const annulButton = await screen.findByRole('button', { name: 'Аннулировать позицию' });
    await user.click(annulButton);

    // The return modal opens in annulment mode.
    expect(await screen.findByRole('button', { name: 'Подтвердить аннулирование' })).toBeInTheDocument();
    // Quantity is fixed (no stepper) to the full outstanding amount.
    expect(screen.getByText('2 шт.')).toBeInTheDocument();

    // A reason is required — the submit button is disabled until one is entered.
    const submit = screen.getByRole('button', { name: 'Подтвердить аннулирование' });
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText('Например: ошибочно пробитая позиция'),
      'Ошибочно пробита',
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(salesApi.processReturn).toHaveBeenCalledWith(
        42,
        {
          items: [{ sale_item_id: 8001, quantity: 2 }],
          refund_method: 'cash',
          notes: '[Аннулирование позиции] Ошибочно пробита',
        },
        'annul-key-0001',
      ),
    );
    expect(metaApi.getSaleReturnOptions).toHaveBeenCalled();
  });
});
