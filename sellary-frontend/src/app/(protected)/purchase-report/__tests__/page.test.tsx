import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PurchaseReportPage from '../page';

const { summary, byProduct, bySupplier, outstanding } = vi.hoisted(() => ({
  summary: vi.fn(),
  byProduct: vi.fn(),
  bySupplier: vi.fn(),
  outstanding: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  purchaseReportApi: { summary, byProduct, bySupplier, outstanding },
}));

const SUMMARY = {
  total_spend: '350.00',
  receipts_count: 2,
  orders_count: 1,
  suppliers_count: 1,
  products_count: 1,
  lines_count: 2,
  average_receipt: '175.00',
  by_day: [
    { day: '2026-07-24', spend: '100.00', receipts: 1 },
    { day: '2026-07-26', spend: '250.00', receipts: 1 },
  ],
};

const PRODUCT_ROW = {
  product_id: 4,
  name: 'Сахар 1кг',
  uom: 'кг',
  quantity: '30.000',
  spend: '350.00',
  share_percent: '100.00',
  average_cost: '11.6667',
  min_cost: '10.0000',
  max_cost: '12.5000',
  first_cost: '10.0000',
  last_cost: '12.5000',
  cost_change_percent: '25.00',
  current_cost_price: '12.5000',
  current_sell_price: '18.0000',
  deliveries: 2,
  last_received_at: '2026-07-26T10:00:00Z',
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PurchaseReportPage />
    </QueryClientProvider>,
  );
};

describe('PurchaseReportPage', () => {
  // The spies are module-level, so a tab opened by one test would otherwise
  // count as a call in the next.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leads with what was spent and on how many deliveries', async () => {
    summary.mockResolvedValue({ data: SUMMARY });
    byProduct.mockResolvedValue({ data: [PRODUCT_ROW] });
    renderPage();

    expect(await screen.findByText('Потрачено на товар')).toBeInTheDocument();
    expect(screen.getByText(/2 позиций в 2 поставках/)).toBeInTheDocument();
  });

  it('shows the price move, not only the spend', async () => {
    summary.mockResolvedValue({ data: SUMMARY });
    byProduct.mockResolvedValue({ data: [PRODUCT_ROW] });
    renderPage();

    expect(await screen.findByText('Сахар 1кг')).toBeInTheDocument();
    // A buying price that went up is the thing the owner needs to notice.
    expect(screen.getByText('+25.0 %')).toBeInTheDocument();
  });

  it('says so plainly when nothing was received', async () => {
    summary.mockResolvedValue({
      data: { ...SUMMARY, total_spend: '0.00', receipts_count: 0, by_day: [] },
    });
    byProduct.mockResolvedValue({ data: [] });
    renderPage();

    expect(await screen.findByText(/товар не принимали/)).toBeInTheDocument();
  });

  it('keeps ordered-but-not-received money out of the spend, on its own tab', async () => {
    summary.mockResolvedValue({ data: SUMMARY });
    byProduct.mockResolvedValue({ data: [PRODUCT_ROW] });
    outstanding.mockResolvedValue({
      data: [
        {
          order_id: 51,
          order_date: '2026-07-25T09:00:00Z',
          supplier_name: 'Оптовик',
          total_amount: '500.00',
          pending_lines: 3,
        },
      ],
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Заказано, но не пришло' }));
    expect(await screen.findByText(/ещё не потрачены/)).toBeInTheDocument();
    expect(screen.getByText('Оптовик')).toBeInTheDocument();
  });

  it('refetches when the period changes', async () => {
    summary.mockResolvedValue({ data: SUMMARY });
    byProduct.mockResolvedValue({ data: [PRODUCT_ROW] });
    renderPage();

    await screen.findByText('Потрачено на товар');
    summary.mockClear();
    await userEvent.click(screen.getByRole('button', { name: '7 дней' }));
    expect(summary).toHaveBeenCalledWith(
      expect.objectContaining({ days: 7, start_date: expect.any(String) }),
    );
  });

  it('does not ask the server for a tab nobody opened', async () => {
    summary.mockResolvedValue({ data: SUMMARY });
    byProduct.mockResolvedValue({ data: [PRODUCT_ROW] });
    renderPage();

    await screen.findByText('Сахар 1кг');
    expect(bySupplier).not.toHaveBeenCalled();
    expect(outstanding).not.toHaveBeenCalled();
  });
});
