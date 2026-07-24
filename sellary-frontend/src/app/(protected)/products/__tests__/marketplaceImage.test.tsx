import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productsApi } from '@/lib/api';
import Products from '../page';

const { product } = vi.hoisted(() => ({
  product: {
    id: 7,
    barcode: '700000000007',
    name: 'Тестовый товар',
    product_type: 'item',
    uom: 'dona',
    cost_price: '80',
    sell_price: '100',
    tax_percent: '0',
    stock_quantity: 37,
    min_stock_level: 5,
    is_active: true,
    is_published: false,
    image_url: null,
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
    uploadImage: vi
      .fn()
      .mockResolvedValue({ data: { ...product, image_url: 'https://cdn.example/up.jpg' } }),
  },
  inventoryApi: { adjust: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
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

describe('Products marketplace image upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads a chosen image for the edited product and shows the preview', async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
    expect(screen.getByText('Редактировать товар')).toBeInTheDocument();

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const input = screen.getByLabelText('Загрузить фото товара') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(productsApi.uploadImage).toHaveBeenCalledWith(product.id, file);
    });

    await waitFor(() => {
      expect(screen.getByAltText('Фото товара')).toHaveAttribute(
        'src',
        'https://cdn.example/up.jpg',
      );
    });
  });
});
