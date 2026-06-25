import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import POS from '../page';
import { useCartStore } from '@/lib/store';
import { useSettingsStore } from '@/store/settingsStore';
import { salesApi } from '@/lib/api';
import { printReceipt } from '@/lib/utils';
import type { Product } from '@/lib/types';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));

vi.mock('@/lib/api', () => ({
  salesApi: { create: vi.fn() },
  productsApi: { getAll: vi.fn().mockResolvedValue({ data: [] }), getByBarcode: vi.fn() },
  categoriesApi: { getAll: vi.fn().mockResolvedValue({ data: [] }) },
}));

// Keep the real utils (formatCurrency, hotkeyManager, registerHotkeys) but spy
// on printReceipt so we can assert whether a receipt was printed at checkout.
vi.mock('@/lib/utils', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/utils')>()),
  printReceipt: vi.fn(),
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

const cashProduct: Product = {
  id: 1,
  barcode: '100000000001',
  name: 'Тестовый товар',
  product_type: 'item',
  uom: 'шт',
  cost_price: '80',
  sell_price: '100',
  tax_percent: '0',
  stock_quantity: 10,
  min_stock_level: 1,
  is_active: true,
  created_at: '2026-06-13T00:00:00Z',
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

  it('shows cash change and blocks checkout when received cash is insufficient', async () => {
    const user = userEvent.setup();
    useCartStore.getState().addItem(cashProduct);

    renderPOS();

    await user.click(screen.getByRole('button', { name: /оплатить/i }));

    const receivedInput = screen.getByRole('textbox', { name: /получено наличными/i });
    expect(receivedInput).toHaveValue('100');

    await user.clear(receivedInput);
    await user.type(receivedInput, '150,5');

    const changeRow = screen.getByText('Сдача').parentElement;
    expect(changeRow).toHaveTextContent('50,5');

    await user.clear(receivedInput);
    await user.type(receivedInput, '80');

    expect(screen.getByText('Не хватает').parentElement).toHaveTextContent('20');
    expect(screen.getByRole('button', { name: /завершить продажу/i })).toBeDisabled();
  });
});

describe('POS receipt printing setting', () => {
  beforeEach(() => {
    localStorage.clear();
    useCartStore.getState().resetState();
    useSettingsStore.setState({ receiptPrintEnabled: false });
    vi.mocked(printReceipt).mockClear();
    vi.mocked(salesApi.create).mockReset();
    vi.mocked(salesApi.create).mockResolvedValue({
      data: { id: 1, items: [], created_at: '2026-06-13T00:00:00Z' },
    } as never);
  });

  const completeCashSale = async (user: ReturnType<typeof userEvent.setup>) => {
    useCartStore.getState().addItem(cashProduct);
    renderPOS();
    await user.click(screen.getByRole('button', { name: /оплатить/i }));
    await user.click(screen.getByRole('button', { name: /завершить продажу/i }));
    await waitFor(() => expect(salesApi.create).toHaveBeenCalled());
    // Let the post-checkout setTimeout(0) fire if it was scheduled.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('prints the receipt when printing is enabled', async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ receiptPrintEnabled: true });

    await completeCashSale(user);

    await waitFor(() => expect(printReceipt).toHaveBeenCalledTimes(1));
  });

  it('does not print the receipt when printing is disabled', async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ receiptPrintEnabled: false });

    await completeCashSale(user);

    expect(printReceipt).not.toHaveBeenCalled();
  });
});
