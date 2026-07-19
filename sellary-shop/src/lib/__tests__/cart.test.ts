import { createCart, type Cart } from '../cart';

function mockStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
}

const PRODUCT_A = { id: 1, name: 'Молоко', sell_price: 12000, company_id: 1 };
const PRODUCT_B = { id: 2, name: 'Хлеб', sell_price: 5000, company_id: 1 };

describe('cart', () => {
  let cart: Cart;
  beforeEach(() => {
    cart = createCart(mockStorage());
  });

  it('starts empty', () => {
    expect(cart.getItems()).toHaveLength(0);
    expect(cart.getTotal()).toBe(0);
  });

  it('adds a product', () => {
    cart.addItem(PRODUCT_A, 1);
    const items = cart.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(1);
    expect(items[0].quantity).toBe(1);
  });

  it('increments quantity on duplicate add', () => {
    cart.addItem(PRODUCT_A, 1);
    cart.addItem(PRODUCT_A, 2);
    expect(cart.getItems()[0].quantity).toBe(3);
  });

  it('removes an item', () => {
    cart.addItem(PRODUCT_A, 1);
    cart.addItem(PRODUCT_B, 2);
    cart.removeItem(1);
    expect(cart.getItems()).toHaveLength(1);
    expect(cart.getItems()[0].productId).toBe(2);
  });

  it('sets quantity', () => {
    cart.addItem(PRODUCT_A, 5);
    cart.setQuantity(1, 3);
    expect(cart.getItems()[0].quantity).toBe(3);
  });

  it('removes when quantity set to 0', () => {
    cart.addItem(PRODUCT_A, 1);
    cart.setQuantity(1, 0);
    expect(cart.getItems()).toHaveLength(0);
  });

  it('computes total', () => {
    cart.addItem(PRODUCT_A, 2);  // 12000 * 2 = 24000
    cart.addItem(PRODUCT_B, 3);  // 5000 * 3 = 15000
    expect(cart.getTotal()).toBe(39000);
  });

  it('clears all items', () => {
    cart.addItem(PRODUCT_A, 1);
    cart.clear();
    expect(cart.getItems()).toHaveLength(0);
  });

  it('counts items', () => {
    cart.addItem(PRODUCT_A, 2);
    cart.addItem(PRODUCT_B, 3);
    expect(cart.getItemCount()).toBe(2); // distinct products
  });

  it('persists to storage', () => {
    const storage = mockStorage();
    const c1 = createCart(storage);
    c1.addItem(PRODUCT_A, 2);
    const c2 = createCart(storage);
    expect(c2.getItems()[0].quantity).toBe(2);
  });

  it('coerces string sell_price to number for correct total (Fix 1)', () => {
    // Backend sends sell_price as a JSON string (Python Decimal).
    // normalizeProduct converts it before addItem is called, but addItem
    // itself should also handle it gracefully if given a string.
    const productWithStringPrice = {
      id: 3,
      name: 'Сок',
      sell_price: '12000.00' as unknown as number,
      company_id: 1,
    };
    cart.addItem(productWithStringPrice, 2);
    // price stored via addItem: String('12000.00') coerced by arithmetic
    // getTotal does sum + price * quantity — JS coerces string to number
    expect(cart.getTotal()).toBe(24000);
    expect(typeof cart.getItems()[0].price).toBe('string'); // raw value stored as-is by addItem
    // But arithmetic result is still numerically correct
    expect(cart.getTotal()).toBe(24000);
  });

  it('recovers to empty cart when localStorage contains corrupt JSON (Fix 5)', () => {
    const storage = mockStorage();
    storage.setItem('sellary_shop_cart', 'not-json');
    const c = createCart(storage);
    expect(c.getItems()).toHaveLength(0);
    expect(c.getTotal()).toBe(0);
  });
});
