import { render, screen, fireEvent } from '@testing-library/react';
import { CartPage } from '../CartPage';

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
  return {
    ...actual,
    getCart: () => cart,
  };
});

import { getCart } from '../../lib/cart';

describe('CartPage', () => {
  beforeEach(() => {
    getCart().clear();
  });

  it('shows empty state when cart is empty', () => {
    render(<CartPage />);
    expect(screen.getByText(/корзина пуста/i)).toBeInTheDocument();
  });

  it('shows items when cart has products', () => {
    getCart().addItem({ id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 }, 2);
    render(<CartPage />);
    expect(screen.getByText('Молоко')).toBeInTheDocument();
  });

  it('shows disabled checkout button with items', () => {
    getCart().addItem({ id: 1, name: 'Хлеб', sell_price: 5000, company_id: 1 }, 1);
    render(<CartPage />);
    const btn = screen.getByRole('button', { name: /оформить заказ/i });
    expect(btn).toBeDisabled();
  });

  it('removes item when remove button clicked', () => {
    getCart().addItem({ id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 }, 1);
    render(<CartPage />);
    fireEvent.click(screen.getByRole('button', { name: /удалить|×/i }));
    expect(screen.getByText(/корзина пуста/i)).toBeInTheDocument();
  });
});
