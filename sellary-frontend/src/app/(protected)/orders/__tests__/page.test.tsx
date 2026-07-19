import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OrdersPage from '../page';
import { ordersApi } from '@/lib/api';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => selector({ currentCompany: { id: 1, role: 'admin' } }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  generateIdempotencyKey: vi.fn(() => 'order-key-001'),
  ordersApi: {
    list: vi.fn(),
    getById: vi.fn(),
    confirm: vi.fn(),
    advanceStatus: vi.fn(),
    cancel: vi.fn(),
  },
}));

const pendingDelivery = {
  id: 10, company_id: 1, order_number: 42, status: 'pending',
  fulfillment_type: 'delivery', delivery_address: 'ул. Рудаки 10',
  contact_phone: '+992900001122', contact_name: 'Фируз', subtotal: '150.00',
  total_amount: '150.00', notes: null, sale_id: null, checkout_group_id: null,
  created_at: '2026-07-19T00:00:00Z', updated_at: '2026-07-19T00:00:00Z',
  items: [{ id: 1, product_id: 5, product_name: 'Хлеб', unit_price: '3.00', quantity: '2', line_total: '6.00' }],
};
const readyPickup = { ...pendingDelivery, id: 11, order_number: 43, status: 'ready', fulfillment_type: 'pickup', delivery_address: null, contact_name: 'Мадина' };

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrdersPage />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ordersApi.list).mockResolvedValue({
    data: { items: [pendingDelivery, readyPickup], total: 2, skip: 0, limit: 100 },
  } as never);
  vi.mocked(ordersApi.getById).mockImplementation((id: number) =>
    Promise.resolve({ data: id === 10 ? pendingDelivery : readyPickup } as never),
  );
});

describe('Merchant orders page', () => {
  it('shows the incoming order list with a new-order badge', async () => {
    renderPage();
    expect(await screen.findByText(/#42/)).toBeInTheDocument();
    expect(screen.getByText('Фируз')).toBeInTheDocument();
    // "Новые" tab carries the pending count.
    expect(screen.getByRole('tab', { name: /Новые/ })).toHaveTextContent('1');
  });

  it('confirms a pending order with an Idempotency-Key and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.confirm).mockResolvedValue({
      data: { ...pendingDelivery, status: 'confirmed', sale_id: 99 },
    } as never);

    renderPage();
    await user.click(await screen.findByText(/#42/));
    await user.click(await screen.findByRole('button', { name: /Подтвердить заказ/ }));

    await waitFor(() =>
      expect(ordersApi.confirm).toHaveBeenCalledWith(10, 'cash', expect.any(String)),
    );
  });

  it('shows the oversell error and keeps the order pending on 400', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.confirm).mockRejectedValue({
      response: { status: 400, data: { detail: 'Insufficient stock for Хлеб' } },
    });

    renderPage();
    await user.click(await screen.findByText(/#42/));
    await user.click(await screen.findByRole('button', { name: /Подтвердить заказ/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient stock');
    // Order stays pending → Confirm button is still there.
    expect(screen.getByRole('button', { name: /Подтвердить заказ/ })).toBeInTheDocument();
  });

  it('pickup order at ready offers "выдан клиенту", not delivering', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.advanceStatus).mockResolvedValue({
      data: { ...readyPickup, status: 'completed' },
    } as never);

    renderPage();
    // Default tab is "Новые" (pending only); switch to "Все" to see the ready/pickup order.
    await user.click(await screen.findByRole('tab', { name: /Все/ }));
    await user.click(await screen.findByText(/#43/));
    // No "в доставку" action for pickup.
    expect(screen.queryByRole('button', { name: /доставку/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Выдан клиенту/i }));

    await waitFor(() => expect(ordersApi.advanceStatus).toHaveBeenCalledWith(11, 'completed'));
  });

  it('cancels an order with a reason', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.cancel).mockResolvedValue({
      data: { ...pendingDelivery, status: 'cancelled' },
    } as never);

    renderPage();
    await user.click(await screen.findByText(/#42/));
    await user.click(await screen.findByRole('button', { name: /^Отменить$/ }));
    await user.type(screen.getByLabelText(/Причина отмены/), 'Нет в наличии');
    await user.click(screen.getByRole('button', { name: /Подтвердить отмену/ }));

    await waitFor(() => expect(ordersApi.cancel).toHaveBeenCalledWith(10, 'Нет в наличии'));
  });
});
