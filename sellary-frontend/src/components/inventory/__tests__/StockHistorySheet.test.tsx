import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StockHistorySheet from '../StockHistorySheet';

const { getLogs } = vi.hoisted(() => ({ getLogs: vi.fn() }));

vi.mock('@/lib/api', () => ({ inventoryApi: { getLogs } }));

const product = {
  id: 4,
  name: 'Сахар 1кг',
  uom: 'dona',
  stock_quantity: 12,
} as any;

const log = {
  id: 1,
  product_id: 4,
  product_name: 'Сахар 1кг',
  user_id: 2,
  user_name: 'Иван Кассир',
  quantity_change: '-3',
  value_change: '-24000',
  previous_quantity: '15',
  new_quantity: '12',
  reason: 'Списание боя',
  reference_type: 'manual_adjust',
  reference_id: null,
  created_at: '2026-07-25T10:00:00Z',
};

const renderSheet = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StockHistorySheet product={product} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
};

describe('StockHistorySheet', () => {
  it('asks only for this product’s movements', async () => {
    getLogs.mockResolvedValue({ data: [log] });
    renderSheet();
    expect(await screen.findByText('Списание боя')).toBeInTheDocument();
    expect(getLogs).toHaveBeenCalledWith({ product_id: 4, limit: 100 });
  });

  it('shows who moved it and what the quantity went from and to', async () => {
    getLogs.mockResolvedValue({ data: [log] });
    renderSheet();

    expect(await screen.findByText('Иван Кассир')).toBeInTheDocument();
    expect(screen.getByText('15 → 12 dona')).toBeInTheDocument();
    expect(screen.getByText('-3')).toBeInTheDocument();
    expect(screen.getByText('Корректировка')).toBeInTheDocument();
  });

  it('signs an increase so a receipt is not mistaken for a write-off', async () => {
    getLogs.mockResolvedValue({
      data: [{ ...log, quantity_change: '5', reference_type: 'po_receive' }],
    });
    renderSheet();
    expect(await screen.findByText('+5')).toBeInTheDocument();
  });

  it('narrows the movements to one receipt', async () => {
    getLogs.mockResolvedValue({ data: [log] });
    renderSheet();
    await screen.findByText('Иван Кассир');

    await userEvent.type(screen.getByLabelText('Номер чека'), '98');

    await vi.waitFor(() =>
      expect(getLogs).toHaveBeenLastCalledWith({
        product_id: 4,
        limit: 100,
        sale_id: 98,
      }),
    );
  });

  it('is a labelled modal dialog that closes on Escape', async () => {
    getLogs.mockResolvedValue({ data: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <StockHistorySheet product={product} onClose={onClose} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('История остатка: Сахар 1кг');

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when a product has never moved', async () => {
    getLogs.mockResolvedValue({ data: [] });
    renderSheet();
    expect(await screen.findByText(/ещё не было движений/)).toBeInTheDocument();
  });
});

describe('StockHistorySheet inside the app shell', () => {
  it('stays interactive when the shell it renders inside is made inert', async () => {
    // Regression: the sheet is rendered inside <main id="main">, and it marks
    // that element inert while open. Without a portal it inerted itself — the
    // close button stopped dispatching clicks.
    getLogs.mockResolvedValue({ data: [] });
    const main = document.createElement('main');
    main.id = 'main';
    document.body.appendChild(main);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <StockHistorySheet product={product} onClose={onClose} />
      </QueryClientProvider>,
      { container: main },
    );

    const closeButton = await screen.findByRole('button', { name: 'Закрыть' });
    expect(main.contains(closeButton)).toBe(false);
    await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();

    main.remove();
  });
});
