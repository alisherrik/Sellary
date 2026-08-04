import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inventoryApi, productsApi } from '@/lib/api';
import Products from '../page';

const { product } = vi.hoisted(() => ({
  product: {
    id: 7,
    barcode: '700000000007',
    name: 'Тестовый товар',
    description: 'Для проверки остатка',
    product_type: 'item',
    uom: 'dona',
    cost_price: '80',
    sell_price: '100',
    tax_percent: '0',
    stock_quantity: 37,
    min_stock_level: 5,
    is_active: true,
    created_at: '2026-06-14T00:00:00Z',
  },
}));

vi.mock('@/hooks/useQueries', () => ({
  useProducts: vi.fn(() => ({ data: [product], isLoading: false })),
  useLowStockProducts: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('@/lib/store', () => ({
  useModules: () => ({ inventory: 'user' }),
}));

vi.mock('@/lib/api', () => ({
  categoriesApi: {
    getAll: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  productsApi: {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ data: product }),
    delete: vi.fn(),
    getById: vi.fn().mockResolvedValue({ data: product }),
  },
  inventoryApi: {
    adjust: vi.fn(),
    getLogs: vi.fn().mockResolvedValue({ data: [] }),
    stocktake: vi.fn().mockResolvedValue({
      data: {
        product_id: 7,
        product_name: 'Тестовый товар',
        previous_quantity: '37.000',
        new_quantity: '30.000',
        delta: '-7.000',
      },
    }),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const renderProducts = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Products />
    </QueryClientProvider>,
  );
};

const openStocktake = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole('button', { name: 'Корректировка остатка' })[0]);
  // The dialog refetches the product before trusting the cached quantity.
  await waitFor(() =>
    expect(screen.getByTestId('stocktake-expected')).toHaveTextContent('37'),
  );
};

describe('Editing a product no longer touches stock', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers no stock field when editing', async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
    expect(screen.getByText('Редактировать товар')).toBeInTheDocument();

    expect(screen.queryByDisplayValue('37')).not.toBeInTheDocument();
    expect(screen.queryByText('Количество *')).not.toBeInTheDocument();
  });

  it('saves an edit without issuing any stock movement', async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);

    await waitFor(() => expect(productsApi.update).toHaveBeenCalled());
    expect(inventoryApi.adjust).not.toHaveBeenCalled();
    expect(inventoryApi.stocktake).not.toHaveBeenCalled();

    const [, payload] = vi.mocked(productsApi.update).mock.calls[0];
    expect(payload).not.toHaveProperty('stock_quantity');
  });

  it('omits a blank minimum stock level instead of sending null', async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
    await user.clear(screen.getByDisplayValue('5'));
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);

    await waitFor(() => expect(productsApi.update).toHaveBeenCalled());
    const [, payload] = vi.mocked(productsApi.update).mock.calls[0];
    expect(payload).not.toHaveProperty('min_stock_level');
  });
});

describe('Stocktake dialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts an absolute count with the quantity it was opened on', async () => {
    const user = userEvent.setup();
    renderProducts();

    await openStocktake(user);
    await user.type(screen.getByLabelText('Фактическое количество *'), '30');
    await user.selectOptions(screen.getByLabelText('Причина *'), 'shortage');
    await user.type(screen.getByLabelText('Комментарий'), 'пересчёт 04.08');
    fireEvent.submit(
      screen.getByRole('button', { name: 'Сохранить' }).closest('form')!,
    );

    await waitFor(() =>
      expect(inventoryApi.stocktake).toHaveBeenCalledWith({
        product_id: 7,
        counted_quantity: '30',
        expected_quantity: '37',
        reason: 'shortage',
        note: 'пересчёт 04.08',
      }),
    );
  });

  it('shows the discrepancy before saving', async () => {
    const user = userEvent.setup();
    renderProducts();

    await openStocktake(user);
    await user.type(screen.getByLabelText('Фактическое количество *'), '43');

    expect(screen.getByTestId('stocktake-delta')).toHaveTextContent('+6');
  });

  it('says nothing will be written when the count matches', async () => {
    const user = userEvent.setup();
    renderProducts();

    await openStocktake(user);
    await user.type(screen.getByLabelText('Фактическое количество *'), '37');

    expect(screen.getByTestId('stocktake-delta')).toHaveTextContent('Расхождения нет');
  });

  it('keeps the dialog open and re-seeds the quantity on a 409', async () => {
    vi.mocked(inventoryApi.stocktake).mockRejectedValueOnce({
      response: {
        status: 409,
        data: { detail: 'Остаток изменился: ожидалось 37, сейчас 34.' },
        headers: { 'x-current-quantity': '34' },
      },
    });

    const user = userEvent.setup();
    renderProducts();

    await openStocktake(user);
    await user.type(screen.getByLabelText('Фактическое количество *'), '30');
    fireEvent.submit(
      screen.getByRole('button', { name: 'Сохранить' }).closest('form')!,
    );

    // Still up, now showing the server's figure to re-confirm against.
    await waitFor(() =>
      expect(screen.getByTestId('stocktake-expected')).toHaveTextContent('34'),
    );
    expect(screen.getByLabelText('Фактическое количество *')).toBeInTheDocument();
  });
});
