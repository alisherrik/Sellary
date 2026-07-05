import { describe, it, expect, beforeEach } from 'vitest';

import { useCartStore } from '@/lib/store';
import { canAdd, isOverStock, nextAddQuantity, remainingStock } from '@/lib/posStock';
import { baseUnit, saleUnits, cartLineKey } from '@/lib/posUnits';
import type { CartUnit, Product } from '@/lib/types';

const product: Product = {
  id: 1,
  barcode: 'RICE-1',
  name: 'Rice',
  product_type: 'item',
  uom: 'kg',
  cost_price: '10',
  sell_price: '12',
  tax_percent: '0',
  stock_quantity: 100,
  min_stock_level: 5,
  is_active: true,
  units: [
    { id: 7, name: 'qop', factor: '5', sell_price: '50', is_active: true, sort_order: 0 },
  ],
  created_at: '2026-06-23T00:00:00Z',
};

const qop: CartUnit = { id: 7, label: 'qop', factor: 5, price: 50 };

const activeItems = () => {
  const state = useCartStore.getState();
  return state.sessions.find((s) => s.id === state.activeSessionId)?.items ?? [];
};

describe('posStock helpers', () => {
  it('computes remaining stock and add-ability in base units', () => {
    expect(remainingStock(10, 4)).toBe(6);
    expect(remainingStock(2.5, 2)).toBeCloseTo(0.5);
    expect(canAdd(10, 9, 1)).toBe(true);
    expect(canAdd(10, 10, 1)).toBe(false);
    expect(canAdd(12, 5, 5)).toBe(true); // 5 + 5 <= 12
    expect(canAdd(12, 10, 5)).toBe(false); // 10 + 5 > 12
    expect(isOverStock(5, 6)).toBe(true);
    expect(isOverStock(5, 5)).toBe(false);
  });

  it('uses a positive fractional remainder as the next catalog add quantity', () => {
    expect(nextAddQuantity(0.5, 0)).toBeCloseTo(0.5);
    expect(nextAddQuantity(1.5, 0)).toBe(1);
    expect(nextAddQuantity(1.5, 1)).toBeCloseTo(0.5);
    expect(nextAddQuantity(0.5, 0.5)).toBe(0);
  });
});

describe('posUnits helpers', () => {
  it('exposes the base unit first, then active extras', () => {
    const units = saleUnits(product);
    expect(units[0]).toEqual(baseUnit(product));
    expect(units[0].id).toBeNull();
    expect(units[1]).toMatchObject({ id: 7, label: 'qop', factor: 5, price: 50 });
  });

  it('builds composite line keys', () => {
    expect(cartLineKey(1, null)).toBe('1:base');
    expect(cartLineKey(1, 7)).toBe('1:7');
  });
});

describe('cart store with units', () => {
  beforeEach(() => {
    localStorage.clear();
    useCartStore.getState().resetState();
  });

  it('keeps the same product in different units as separate lines', () => {
    const store = useCartStore.getState();
    store.addItem(product); // base unit
    store.addItem(product, qop, 2); // 2 sacks

    const items = activeItems();
    expect(items).toHaveLength(2);
    expect(items[0].unit.id).toBeNull();
    expect(items[1].unit.id).toBe(7);
    expect(items[1].quantity).toBe(2);
  });

  it('merges adds of the same product+unit', () => {
    const store = useCartStore.getState();
    store.addItem(product, qop, 1);
    store.addItem(product, qop, 2);
    const items = activeItems();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('computes subtotal from each line unit price', () => {
    const store = useCartStore.getState();
    store.addItem(product); // 12 * 1
    store.addItem(product, qop, 2); // 50 * 2
    expect(useCartStore.getState().getSubtotal()).toBe(112);
  });

  it('addresses lines by composite key for updates and removal', () => {
    const store = useCartStore.getState();
    store.addItem(product, qop, 1);
    store.updateQuantity(cartLineKey(product.id, 7), 4);
    expect(activeItems()[0].quantity).toBe(4);

    store.removeItem(cartLineKey(product.id, 7));
    expect(activeItems()).toHaveLength(0);
  });

  it('changeUnit moves a line and merges on collision', () => {
    const store = useCartStore.getState();
    store.addItem(product, baseUnit(product), 1); // base line, qty 1
    store.addItem(product, qop, 1); // qop line, qty 1

    // Switch the base line onto the qop unit -> merges into the qop line.
    store.changeUnit(cartLineKey(product.id, null), qop);
    const items = activeItems();
    expect(items).toHaveLength(1);
    expect(items[0].unit.id).toBe(7);
    expect(items[0].quantity).toBe(2);
  });
});
