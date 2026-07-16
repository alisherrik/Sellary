import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSaleSearchSuggestions, useInfiniteSales, useSalesSummary } from '@/hooks/useQueries';
import SalesHistory from '../page';
import { customersApi } from '@/lib/api';

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

const cardSale = {
  ...sale,
  id: 43,
  customer_id: undefined,
  customer_name: undefined,
  payment_method: 'card' as const,
  card_type: 'alif' as const,
  total_amount: '55.00',
  created_at: '2026-07-03T10:00:00Z',
};

vi.mock('@/hooks/useQueries', () => ({
  useInfiniteSales: vi.fn(),
  useSalesSummary: vi.fn(),
  useSaleSearchSuggestions: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  customersApi: {
    recordPayment: vi.fn(),
  },
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

const infiniteResult = (overrides: Record<string, unknown> = {}) => ({
  sales: [sale, cardSale],
  total: 2,
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
  hasMore: false,
  loadMore: vi.fn(),
  refetch: vi.fn(),
  ...overrides,
});

const summaryResult = (overrides: Record<string, unknown> = {}) => ({
  data: {
    turnover: '88.00',
    refunds: '0.00',
    net_turnover: '88.00',
    count: 2,
    average_check: '44.00',
    refund_operations: 0,
    hourly: [{ hour: 10, turnover: '88.00' }],
    ...overrides,
  },
  isLoading: false,
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

describe('Sales history smart search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useInfiniteSales).mockReturnValue(infiniteResult() as any);
    vi.mocked(useSalesSummary).mockReturnValue(summaryResult() as any);
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
        expect(useInfiniteSales).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 200, search: 'колаа' }),
        ),
      { timeout: 1500 },
    );
  });

  it('combines return tab with server search params', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Возвраты' }));

    await waitFor(() =>
      expect(useInfiniteSales).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 200, status_group: 'returns' }),
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
        expect(useInfiniteSales).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'Кола' }),
        ),
      { timeout: 1500 },
    );
  });

  it('combines date range params with a server-side payment method filter', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByLabelText('Дата от')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Фильтры' }));

    fireEvent.change(screen.getByLabelText('Дата от'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByLabelText('Дата до'), {
      target: { value: '2026-07-31' },
    });

    await waitFor(() =>
      expect(useInfiniteSales).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: 200,
          start_date: '2026-07-01T00:00:00',
          end_date: '2026-07-31T23:59:59',
        }),
      ),
    );

    await user.selectOptions(screen.getByLabelText('Способ оплаты'), 'card');

    // The payment filter goes to the server rather than narrowing the loaded
    // page: filtering client-side left the KPI totals describing every payment
    // method while the list showed one.
    await waitFor(() =>
      expect(useInfiniteSales).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payment_method: 'card',
          start_date: '2026-07-01T00:00:00',
          end_date: '2026-07-31T23:59:59',
        }),
      ),
    );
  });

  it('asks the server for totals over the whole filtered history, not the loaded page', async () => {
    renderPage();

    // The card must not be a sum of `sales`: the list arrives 200 rows at a
    // time, so that sum under-reported turnover until "load more" was clicked.
    expect(useSalesSummary).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
    expect(screen.getByText('Оборот')).toBeInTheDocument();
    expect(screen.getAllByText(/88/).length).toBeGreaterThan(0);
  });

  it('renders hourly bars from the server buckets at a visible height', () => {
    vi.mocked(useSalesSummary).mockReturnValue(
      summaryResult({
        hourly: [
          { hour: 8, turnover: '215.49' },
          { hour: 21, turnover: '1177.69' },
        ],
      }) as any,
    );
    const { container } = renderPage();

    const bars = Array.from(container.querySelectorAll<HTMLElement>('[class*="bg-blue-500"]'));
    const heights = bars.map((b) => parseFloat(b.style.height)).filter((h) => h > 0);

    // The tallest bucket anchors the scale; the smaller one stays proportional.
    expect(heights).toContain(100);
    expect(heights.some((h) => h > 0 && h < 100)).toBe(true);

    // Layout is not asserted here — happy-dom does no layout, and this chart's
    // real failure was CSS: `items-end` on the row collapsed the bar box to 0px
    // so every height% resolved against nothing. Verified by measurement in a
    // real browser instead.
  });

  it('keeps the turnover card steady when another page loads', async () => {
    const { rerender } = renderPage();

    // One sale on screen, but the summary still describes all of them.
    vi.mocked(useInfiniteSales).mockReturnValue(
      infiniteResult({ sales: [sale], hasMore: true }) as any,
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SalesHistory />
      </QueryClientProvider>,
    );

    expect(screen.getAllByText(/88/).length).toBeGreaterThan(0);
  });

  it('loads the next page of older receipts on demand', async () => {
    const loadMore = vi.fn();
    vi.mocked(useInfiniteSales).mockReturnValue(
      infiniteResult({ total: 5, hasMore: true, loadMore }) as any,
    );
    const user = userEvent.setup();
    renderPage();

    const loadMoreButton = screen.getByRole('button', { name: /Показать ещё/ });
    await user.click(loadMoreButton);

    expect(loadMore).toHaveBeenCalled();
  });

  it('hides the load-more control when the whole history is loaded', () => {
    vi.mocked(useInfiniteSales).mockReturnValue(
      infiniteResult({ total: 2, hasMore: false }) as any,
    );
    renderPage();

    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
  });

  it('shows credit debt status and accepts a debt payment from sale details', async () => {
    const user = userEvent.setup();
    vi.mocked(useInfiniteSales).mockReturnValue(
      infiniteResult({
        sales: [
          {
            ...sale,
            payment_method: 'credit',
            payment_status: 'unpaid',
            credit_amount: '33.00',
            credit_paid_amount: '5.00',
            credit_remaining_amount: '28.00',
          },
        ],
        total: 1,
      }) as any,
    );
    vi.mocked(customersApi.recordPayment).mockResolvedValue({
      data: { customer_id: 3, balance: '18.00', entries: [] },
    } as never);

    renderPage();

    expect((await screen.findAllByText(/В долг/)).length).toBeGreaterThan(0);

    await user.click(screen.getAllByText('#42')[0]);

    expect(screen.getAllByText('Осталось по долгу').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Не оплачено/).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: /принять оплату долга/i })[0]);
    await user.clear(screen.getByLabelText('Сумма оплаты'));
    await user.type(screen.getByLabelText('Сумма оплаты'), '10');
    await user.click(screen.getByRole('button', { name: /^сохранить оплату$/i }));

    await waitFor(() =>
      expect(customersApi.recordPayment).toHaveBeenCalledWith(
        3,
        { amount: '10', payment_method: 'cash', description: undefined },
        'search-test-key-1234',
      ),
    );
  });
});
