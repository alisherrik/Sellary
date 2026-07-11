import { describe, it, expect } from 'vitest';
import { baseUnit, saleUnits, hasMultipleUnits, cartLineKey, toCartUnit } from '../posUnits';

const product = { uom: 'шт', sell_price: 5000 };

describe('posUnits (dormant multi-UOM)', () => {
  it('baseUnit maps a product to its base cart unit', () => {
    expect(baseUnit(product)).toEqual({ id: null, label: 'шт', factor: 1, price: 5000 });
  });

  it('hasMultipleUnits is false when no product_units exist (Phase 1)', () => {
    expect(hasMultipleUnits(product)).toBe(false);
    expect(saleUnits(product)).toHaveLength(1);
  });

  it('lights up when active units are present', () => {
    const withUnits = {
      ...product,
      units: [{ id: 7, name: 'ящик', factor: 12, sell_price: 55000, is_active: true, sort_order: 0 }],
    };
    expect(hasMultipleUnits(withUnits)).toBe(true);
    expect(saleUnits(withUnits)).toHaveLength(2);
    expect(toCartUnit(withUnits.units[0])).toEqual({ id: 7, label: 'ящик', factor: 12, price: 55000 });
  });

  it('cartLineKey is stable per product+unit', () => {
    expect(cartLineKey(3, null)).toBe('3:base');
    expect(cartLineKey(3, 7)).toBe('3:7');
  });
});
