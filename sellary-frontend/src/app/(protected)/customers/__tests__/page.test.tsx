import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CustomersPage from '../page';
import { customersApi } from '@/lib/api';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) =>
    selector({ currentCompany: { id: 1, role: 'admin' } }),
}));

vi.mock('@/lib/api', () => ({
  generateIdempotencyKey: vi.fn(() => 'customer-payment-key-001'),
  customersApi: {
    getAll: vi.fn(),
    getLedger: vi.fn(),
    create: vi.fn(),
    recordPayment: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomersPage />
    </QueryClientProvider>,
  );
};

describe('Customers credit ledger page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(customersApi.getAll).mockResolvedValue({
      data: [
        {
          id: 7,
          name: 'Фируз Саидов',
          phone: '+992900001122',
          description: 'Сосед',
          balance: '30.00',
          is_active: true,
          created_at: '2026-07-06T00:00:00Z',
        },
        {
          id: 8,
          name: 'Мадина Каримова',
          phone: '+992900003344',
          description: null,
          balance: '0.00',
          is_active: true,
          created_at: '2026-07-06T00:00:00Z',
        },
      ],
    } as never);
    vi.mocked(customersApi.getLedger).mockResolvedValue({
      data: {
        customer_id: 7,
        balance: '30.00',
        entries: [
          {
            id: 1,
            customer_id: 7,
            sale_id: 42,
            entry_type: 'credit_sale',
            amount: '30.00',
            payment_method: null,
            description: 'Продажа в долг #42',
            created_by_user_id: 2,
            created_at: '2026-07-06T00:00:00Z',
          },
        ],
      },
    } as never);
  });

  it('shows client balance and accepts a debt payment', async () => {
    const user = userEvent.setup();
    vi.mocked(customersApi.recordPayment).mockResolvedValue({
      data: { customer_id: 7, balance: '20.00', entries: [] },
    } as never);

    renderPage();

    expect((await screen.findAllByText('Фируз Саидов')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('+992900001122').length).toBeGreaterThan(0);
    expect(screen.getByText('Сосед')).toBeInTheDocument();
    expect(screen.getAllByText(/30/).length).toBeGreaterThan(0);
    expect(await screen.findByText('Продажа в долг #42')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /принять оплату долга/i }));
    await user.type(screen.getByLabelText('Сумма оплаты'), '10');
    await user.selectOptions(screen.getByLabelText('Способ оплаты долга'), 'cash');
    await user.click(screen.getByRole('button', { name: /^сохранить оплату$/i }));

    await waitFor(() =>
      expect(customersApi.recordPayment).toHaveBeenCalledWith(
        7,
        { amount: '10', payment_method: 'cash', description: undefined },
        expect.any(String),
      ),
    );
  });

  it('filters customers by server search and local debt status', async () => {
    const user = userEvent.setup();
    renderPage();

    expect((await screen.findAllByText('Фируз Саидов')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'С долгом' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Фильтры' }));

    await user.click(screen.getByRole('button', { name: 'С долгом' }));
    expect(screen.getAllByText('Фируз Саидов').length).toBeGreaterThan(0);
    expect(screen.queryByText('Мадина Каримова')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Фильтры' }));
    await user.click(screen.getByRole('button', { name: 'Без долга' }));
    expect(screen.getAllByText('Мадина Каримова').length).toBeGreaterThan(0);
    expect(screen.queryByText('Фируз Саидов')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Поиск клиентов' }), 'Мадина');

    await waitFor(
      () =>
        expect(customersApi.getAll).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 200, search: 'Мадина' }),
        ),
      { timeout: 1500 },
    );
  });
});
