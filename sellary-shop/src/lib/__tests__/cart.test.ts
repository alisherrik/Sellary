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
});
