import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '../cart-store';
import { cartLineKey } from '../posUnits';
import type { LocalProduct } from '../db';

const make = (over: Partial<LocalProduct> = {}): LocalProduct => ({
  id: 1, barcode: null, name: 'A', uom: 'шт', category_id: null,
  sell_price: 1000, tax_percent: 0, stock_quantity: 10, is_active: true,
  updated_at: '2026-01-01', ...over,
});

beforeEach(() => useCartStore.setState({ items: [] }));

describe('cart-store', () => {
  it('adds a new line and merges repeat adds of the same product+unit', () => {
    const p = make();
    useCartStore.getState().addItem(p);
    useCartStore.getState().addItem(p, undefined, 2);
    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('updates quantity and removes by line key', () => {
    const p = make();
    const s = useCartStore.getState();
    s.addItem(p);
    const key = cartLineKey(p.id, null);
    s.updateQuantity(key, 5);
    expect(useCartStore.getState().items[0].quantity).toBe(5);
    s.removeItem(key);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('setDiscount stores a per-unit discount on the line', () => {
    const p = make();
    const s = useCartStore.getState();
    s.addItem(p);
    s.setDiscount(cartLineKey(p.id, null), 250);
    expect(useCartStore.getState().items[0].discount).toBe(250);
  });

  it('changeUnit merges onto an existing collision line and resets discount', () => {
    const p = make();
    const s = useCartStore.getState();
    s.addItem(p); // base line
    s.addItem(p, { id: 7, label: 'ящик', factor: 12, price: 11000 }, 1);
    const baseKey = cartLineKey(p.id, null);
    // move the box line onto the base line
    const boxKey = cartLineKey(p.id, 7);
    useCartStore.getState().changeUnit(boxKey, { id: null, label: 'шт', factor: 1, price: 1000 });
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].discount).toBe(0);
    expect(baseKey).toBe('1:base');
  });

  it('getSubtotal and getTax sum line prices and per-product tax', () => {
    const s = useCartStore.getState();
    s.addItem(make({ id: 1, sell_price: 1000, tax_percent: 12 }), undefined, 2);
    s.addItem(make({ id: 2, sell_price: 500, tax_percent: 0 }), undefined, 1);
    expect(useCartStore.getState().getSubtotal()).toBe(2500);
    expect(useCartStore.getState().getTax()).toBeCloseTo(240, 9);
  });

  it('clearCart empties the cart', () => {
    const s = useCartStore.getState();
    s.addItem(make());
    s.clearCart();
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});
