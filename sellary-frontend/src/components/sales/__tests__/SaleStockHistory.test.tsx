import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import SaleStockHistory from '../SaleStockHistory';

const { getLogs } = vi.hoisted(() => ({ getLogs: vi.fn() }));

vi.mock('@/lib/api', () => ({ inventoryApi: { getLogs } }));

const renderBlock = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SaleStockHistory saleId={98} />
    </QueryClientProvider>,
  );
};

describe('SaleStockHistory', () => {
  it('asks the server for this receipt only', async () => {
    getLogs.mockResolvedValue({
      data: [
        {
          id: 1,
          product_id: 4,
          product_name: 'Сахар 1кг',
          user_id: 2,
          user_name: 'Иван Кассир',
          quantity_change: '-2',
          value_change: '-20',
          previous_quantity: '15',
          new_quantity: '13',
          reason: 'Sale #98',
          reference_type: 'sale',
          reference_id: 98,
          created_at: '2026-07-25T10:00:00Z',
        },
      ],
    });

    renderBlock();

    expect(await screen.findByText('Сахар 1кг')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(getLogs).toHaveBeenCalledWith({ sale_id: 98, limit: 100 });
  });

  it('stays out of the way when the cashier cannot read the ledger', async () => {
    getLogs.mockRejectedValue(new Error('403'));
    const { container } = renderBlock();

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
