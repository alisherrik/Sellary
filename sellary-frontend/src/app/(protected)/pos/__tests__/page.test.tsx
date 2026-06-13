import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import POS from '../page';
import { useCartStore } from '@/lib/store';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));

vi.mock('@/lib/api', () => ({
  salesApi: { create: vi.fn() },
  productsApi: { getAll: vi.fn().mockResolvedValue({ data: [] }), getByBarcode: vi.fn() },
  categoriesApi: { getAll: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const renderPOS = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <POS />
    </QueryClientProvider>,
  );
};

describe('POS multi-sale sessions', () => {
  beforeEach(() => {
    localStorage.clear();
    useCartStore.getState().resetState();
  });

  it('opens a new empty sale when the cashier clicks the new sale button', async () => {
    const user = userEvent.setup();

    renderPOS();

    expect(screen.getByRole('tab', { name: /продажа 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /новая продажа/i }));

    expect(screen.getByRole('tab', { name: /продажа 2/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Корзина пуста')).toBeInTheDocument();
  });
});
