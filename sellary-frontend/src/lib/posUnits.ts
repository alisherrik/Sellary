/**
 * Multi-UOM helpers for the POS. A product is always sellable in its base unit
 * (uom + sell_price, factor 1) plus any active additional units. Cart lines are
 * keyed by product + unit so the same product can appear in different units.
 */
import type { CartUnit, Product, ProductUnit } from './types';

export function baseUnit(product: Product): CartUnit {
  return { id: null, label: product.uom, factor: 1, price: Number(product.sell_price) };
}

export function toCartUnit(unit: ProductUnit): CartUnit {
  return {
    id: unit.id,
    label: unit.name,
    factor: Number(unit.factor),
    price: Number(unit.sell_price),
  };
}

/** All sellable units for a product: base unit first, then active extras. */
export function saleUnits(product: Product): CartUnit[] {
  const extras = (product.units ?? [])
    .filter((unit) => unit.is_active !== false)
    .map(toCartUnit);
  return [baseUnit(product), ...extras];
}

/** Whether a product offers more than just its base unit. */
export function hasMultipleUnits(product: Product): boolean {
  return (product.units ?? []).some((unit) => unit.is_active !== false);
}

/** Stable identity for a cart line (product + chosen unit). */
export function cartLineKey(productId: number, unitId: number | null): string {
  return `${productId}:${unitId ?? 'base'}`;
}
