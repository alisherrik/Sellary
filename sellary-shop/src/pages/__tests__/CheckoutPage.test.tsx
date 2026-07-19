import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock cart — same pattern as CartPage.test.tsx
// ---------------------------------------------------------------------------
const { mockStorage } = vi.hoisted(() => {
  const store: Record<string, string> = {};
  const mockStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => Object.keys(store).forEach(k => delete store[k]),
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
  return { mockStorage };
});

vi.mock('../../lib/cart', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cart')>('../../lib/cart');
  const cart = actual.createCart(mockStorage);
  return { ...actual, getCart: () => cart };
});

// ---------------------------------------------------------------------------
// Mock placeOrder — must be hoisted so the factory can reference it
// ---------------------------------------------------------------------------
const { mockPlaceOrder } = vi.hoisted(() => ({ mockPlaceOrder: vi.fn() }));
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return { ...actual, placeOrder: mockPlaceOrder };
});

// ---------------------------------------------------------------------------
// Mock initData
// ---------------------------------------------------------------------------
vi.mock('../../telegram/initData', () => ({
  getInitDataString: () => 'auth_date=1&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Alisher%22%7D&hash=test',
  getInitData: () => ({ user: { id: 1, first_name: 'Alisher', username: 'ali' }, authDate: 1, hash: 'test', raw: '' }),
}));

// ---------------------------------------------------------------------------
import { getCart } from '../../lib/cart';
import { CheckoutPage } from '../CheckoutPage';

function renderCheckout() {
  return render(
    <MemoryRouter>
      <CheckoutPage />
    </MemoryRouter>,
  );
}

describe('CheckoutPage', () => {
  beforeEach(() => {
    getCart().clear();
    mockPlaceOrder.mockReset();
  });

  it('shows empty-cart fallback when cart is empty', () => {
    renderCheckout();
    expect(screen.getByText(/корзина пуста/i)).toBeInTheDocument();
  });

  it('renders the form when cart has items', () => {
    getCart().addItem({ id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 }, 2);
    renderCheckout();
    expect(screen.getByLabelText(/имя/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/телефон/i)).toBeInTheDocument();
  });

  it('prefills contact name from Telegram first_name', () => {
    getCart().addItem({ id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 }, 1);
    renderCheckout();
    const nameInput = screen.getByLabelText(/имя/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Alisher');
  });

  it('submit button is disabled when phone is empty', () => {
    getCart().addItem({ id: 1, name: 'Хлеб', sell_price: 5000, company_id: 1 }, 1);
    renderCheckout();
    const btn = screen.getByRole('button', { name: /оформить заказ/i });
    expect(btn).toBeDisabled();
  });

  it('submit button is disabled when phone is too short (< 7 chars)', () => {
    getCart().addItem({ id: 1, name: 'Хлеб', sell_price: 5000, company_id: 1 }, 1);
    renderCheckout();
    fireEvent.change(screen.getByLabelText(/телефон/i), { target: { value: '123' } });
    const btn = screen.getByRole('button', { name: /оформить заказ/i });
    expect(btn).toBeDisabled();
  });

  it('delivery address field is hidden for pickup and shown for delivery', () => {
    getCart().addItem({ id: 1, name: 'Хлеб', sell_price: 5000, company_id: 1 }, 1);
    renderCheckout();

    // By default pickup is selected — no address field
    expect(screen.queryByLabelText(/адрес доставки/i)).not.toBeInTheDocument();

    // Switch to delivery
    fireEvent.click(screen.getByDisplayValue('delivery'));
    expect(screen.getByLabelText(/адрес доставки/i)).toBeInTheDocument();

    // Switch back to pickup
    fireEvent.click(screen.getByDisplayValue('pickup'));
    expect(screen.queryByLabelText(/адрес доставки/i)).not.toBeInTheDocument();
  });

  it('calls placeOrder with the built payload on submit', async () => {
    getCart().addItem({ id: 5, name: 'Сок', sell_price: 7000, company_id: 2 }, 3);

    mockPlaceOrder.mockResolvedValueOnce({
      orders: [{ id: 1, company_id: 2, order_number: 'ORD-001', status: 'pending', total_amount: 21000 }],
    });

    renderCheckout();

    // Fill required phone
    fireEvent.change(screen.getByLabelText(/телефон/i), { target: { value: '+99290000001' } });

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /оформить заказ/i }));
    });

    expect(mockPlaceOrder).toHaveBeenCalledOnce();
    const [orders] = mockPlaceOrder.mock.calls[0] as [Parameters<typeof mockPlaceOrder>[0]];
    expect(orders).toHaveLength(1);
    expect(orders[0].company_id).toBe(2);
    expect(orders[0].items[0]).toMatchObject({ product_id: 5, quantity: 3, unit_price: 7000 });
    expect(orders[0].contact_phone).toBe('+99290000001');
  });

  it('shows confirmation with order_number on success', async () => {
    getCart().addItem({ id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 }, 1);

    mockPlaceOrder.mockResolvedValueOnce({
      orders: [{ id: 10, company_id: 1, order_number: 'ORD-042', status: 'pending', total_amount: 12000 }],
    });

    renderCheckout();
    fireEvent.change(screen.getByLabelText(/телефон/i), { target: { value: '+99290000001' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /оформить заказ/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/ORD-042/)).toBeInTheDocument();
    });
    expect(screen.getByText(/заказ оформлен/i)).toBeInTheDocument();
  });

  it('shows a string error (not a crash) on a 422-array-style error', async () => {
    getCart().addItem({ id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 }, 1);

    // placeOrder throws an Error (as shopFetch does on non-ok); the message is the coerced string
    mockPlaceOrder.mockRejectedValueOnce(new Error('422 Unprocessable Entity'));

    renderCheckout();
    fireEvent.change(screen.getByLabelText(/телефон/i), { target: { value: '+99290000001' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /оформить заказ/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/422/)).toBeInTheDocument();
    });
    // Make sure we're not crashing — confirmation screen should NOT be shown
    expect(screen.queryByText(/заказ оформлен/i)).not.toBeInTheDocument();
  });
});
