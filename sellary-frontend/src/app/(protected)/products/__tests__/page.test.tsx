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
  },
  inventoryApi: {
    adjust: vi.fn().mockResolvedValue({ data: { new_quantity: 0 } }),
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

describe('Products stock editing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets stock to zero through an audited inventory adjustment', async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
    expect(screen.getByText('Редактировать товар')).toBeInTheDocument();

    const stockInput = screen.getByDisplayValue('37');
    await user.clear(stockInput);
    await user.type(stockInput, '0');
    const saveButton = screen.getByRole('button', { name: 'Сохранить' });
    fireEvent.submit(saveButton.closest('form')!);

    await waitFor(() => {
      expect(productsApi.update).toHaveBeenCalledWith(
        product.id,
        expect.not.objectContaining({ stock_quantity: expect.anything() }),
      );
      expect(inventoryApi.adjust).toHaveBeenCalledWith({
        product_id: product.id,
        quantity_change: -37,
        reason: 'Корректировка остатка при редактировании товара',
      });
    });
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
