import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));

vi.mock('@/lib/api', () => ({
  salesApi: { create: vi.fn() },
  customersApi: {
    getAll: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
  },
  productsApi: { getAll: vi.fn().mockResolvedValue({ data: [] }), getByBarcode: vi.fn() },
  categoriesApi: { getAll: vi.fn().mockResolvedValue({ data: [] }) },
  // A shift is open by default so the checkout gate lets these sale flows run.
  // The gate itself is covered separately.
  shiftsApi: {
    getCurrent: vi.fn().mockResolvedValue({
      data: {
        id: 1,
        shift_number: 1,
        status: 'open',
        opened_at: '2026-07-16T08:00:00Z',
        opened_by_user_id: 1,
        opening_cash: '0.00',
        closed_at: null,
        closed_by_user_id: null,
        counted_cash: null,
        expected_cash: null,
        discrepancy: null,
        notes: null,
        totals: {
          cash_sales: '0.00', card_sales: '0.00', card_by_type: {}, mobile_sales: '0.00',
          credit_sales: '0.00', debt_payments_by_method: {}, refunds_by_method: {},
          sales_count: 0, expected_cash: '0.00',
        },
      },
    }),
    open: vi.fn(),
  },
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import POS from '../page';
import { useAuthStore, useCartStore } from '@/lib/store';
import { useSettingsStore } from '@/store/settingsStore';
import { salesApi, customersApi, productsApi } from '@/lib/api';
import { printReceipt } from '@/lib/utils';
import type { CompanySummary, Product, User } from '@/lib/types';

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

const testUser: User = {
  id: 1,
  username: 'admin',
  email: 'admin@example.com',
  global_role: 'standard',
  is_active: true,
  created_at: '2026-06-13T00:00:00Z',
};

const testCompany: CompanySummary = {
  id: 1,
  name: 'Sellary Demo',
  slug: 'sellary-demo',
  is_active: true,
  role: 'admin',
  is_default: true,
};

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    companies: [],
    currentCompany: null,
    loginToken: null,
    accessToken: null,
    isAuthenticated: false,
    hasHydrated: true,
    modules: { pos: 'user' },
  });
  vi.mocked(productsApi.getAll).mockReset();
  vi.mocked(productsApi.getAll).mockResolvedValue({ data: [] } as never);
});

const outOfStockProduct: Product = {
  ...cashProduct,
  id: 2,
  barcode: '100000000002',
  name: 'Неточный товар',
  sell_price: '25',
  stock_quantity: 0,
};

const lowStockProduct: Product = {
  ...cashProduct,
  id: 3,
  barcode: '100000000003',
  name: 'Последняя пачка',
  sell_price: '15',
  stock_quantity: 1,
  min_stock_level: 2,
};

describe('POS catalog filters', () => {
  beforeEach(() => {
    localStorage.clear();
    useCartStore.getState().resetState();
  });

  it('opens compact filters and filters catalog products by stock status', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      user: testUser,
      companies: [testCompany],
      currentCompany: testCompany,
      loginToken: null,
      accessToken: 'test-token',
      isAuthenticated: true,
      hasHydrated: true,
    });
    vi.mocked(productsApi.getAll).mockResolvedValue({
      data: [cashProduct, outOfStockProduct, lowStockProduct],
    } as never);

    renderPOS();

    expect(await screen.findByText('Тестовый товар')).toBeInTheDocument();
    expect(screen.getByText('Неточный товар')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Нет в наличии' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Фильтры' }));
    await user.click(screen.getByRole('button', { name: 'Нет в наличии' }));

    expect(screen.getByText('Неточный товар')).toBeInTheDocument();
    expect(screen.queryByText('Тестовый товар')).not.toBeInTheDocument();
    expect(screen.queryByText('Последняя пачка')).not.toBeInTheDocument();
  });
});

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

describe('POS credit payment', () => {
  beforeEach(() => {
    localStorage.clear();
    useCartStore.getState().resetState();
    useSettingsStore.setState({ receiptPrintEnabled: false });
    vi.mocked(salesApi.create).mockReset();
    vi.mocked(customersApi.getAll).mockReset();
    vi.mocked(customersApi.getAll).mockResolvedValue({ data: [] } as never);
    vi.mocked(customersApi.create).mockReset();
    vi.mocked(salesApi.create).mockResolvedValue({
      data: { id: 2, items: [], created_at: '2026-07-05T00:00:00Z' },
    } as never);
  });

  it('requires a customer before completing a credit sale', async () => {
    const user = userEvent.setup();
    useCartStore.getState().addItem(cashProduct);

    renderPOS();
    await user.click(screen.getByRole('button', { name: /оплатить/i }));
    await user.click(screen.getByRole('button', { name: /в долг/i }));

    expect(
      screen.queryByRole('textbox', { name: /получено наличными/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Клиент для продажи в долг')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /завершить продажу/i })).toBeDisabled();
    expect(salesApi.create).not.toHaveBeenCalled();
  });

  it('creates a quick customer and sends a real credit sale with customer_id', async () => {
    const user = userEvent.setup();
    useCartStore.getState().addItem(cashProduct);
    vi.mocked(customersApi.create).mockResolvedValue({
      data: {
        id: 77,
        name: 'Фируз Саидов',
        phone: '+992900001122',
        description: 'Сосед',
        balance: '0.00',
        is_active: true,
        created_at: '2026-07-06T00:00:00Z',
      },
    } as never);

    renderPOS();
    await user.click(screen.getByRole('button', { name: /оплатить/i }));
    await user.click(screen.getByRole('button', { name: /в долг/i }));

    await user.type(screen.getByLabelText('ФИО клиента'), 'Фируз Саидов');
    await user.type(screen.getByLabelText('Телефон клиента'), '+992900001122');
    await user.type(screen.getByLabelText('Описание клиента'), 'Сосед');
    await user.click(screen.getByRole('button', { name: /создать клиента/i }));

    await waitFor(() => expect(customersApi.create).toHaveBeenCalledWith({
      name: 'Фируз Саидов',
      phone: '+992900001122',
      description: 'Сосед',
    }));

    await user.type(screen.getByLabelText('Оплачено сейчас'), '40');
    await user.click(screen.getByRole('button', { name: 'Первый платеж: Мобильный' }));
    expect(screen.getByText('Останется долг').parentElement).toHaveTextContent('60');

    await user.click(screen.getByRole('button', { name: /завершить продажу/i }));

    await waitFor(() =>
      expect(salesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'credit',
          customer_id: 77,
          paid_amount: 40,
          initial_payment_method: 'mobile',
        }),
      ),
    );
    expect(vi.mocked(salesApi.create).mock.calls[0][0]).not.toHaveProperty('notes');
    expect(vi.mocked(salesApi.create).mock.calls[0][0]).not.toHaveProperty('card_type');
  });

  it('blocks credit checkout when upfront payment exceeds the sale total', async () => {
    const user = userEvent.setup();
    useCartStore.getState().addItem(cashProduct);
    vi.mocked(customersApi.getAll).mockResolvedValue({
      data: [
        {
          id: 88,
          name: 'Мадина Каримова',
          phone: '+992900009988',
          balance: '0.00',
          is_active: true,
          created_at: '2026-07-06T00:00:00Z',
        },
      ],
    } as never);

    renderPOS();
    await user.click(screen.getByRole('button', { name: /оплатить/i }));
    await user.click(screen.getByRole('button', { name: /в долг/i }));
    await user.click(await screen.findByRole('button', { name: /мадина каримова/i }));
    await user.type(screen.getByLabelText('Оплачено сейчас'), '120');

    expect(screen.getByText('Останется долг').parentElement).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /завершить продажу/i })).toBeDisabled();
    expect(salesApi.create).not.toHaveBeenCalled();
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
