/**
 * Multi-UOM helpers for the cashier POS — retyped copy of the web helpers.
 * Phase 1: dormant. Local `product_units` is empty, LocalProduct carries no
 * `units`, so hasMultipleUnits() returns false and the register runs
 * base-unit-only. Lights up automatically once units are populated (Phase 2).
 */

export interface LocalProductUnit {
  id: number;
  name: string;
  factor: number;
  sell_price: number | null;
  barcode?: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface LocalCartUnit {
  id: number | null;
  label: string;
  factor: number;
  price: number;
}

// Structural product shape the helpers need. LocalProduct (db.ts) satisfies this;
// `units` is optional and absent in Phase 1.
export interface UnitBearingProduct {
  uom: string;
  sell_price: number;
  units?: LocalProductUnit[];
}

export function baseUnit(product: UnitBearingProduct): LocalCartUnit {
  return { id: null, label: product.uom, factor: 1, price: Number(product.sell_price) };
}

export function toCartUnit(unit: LocalProductUnit): LocalCartUnit {
  return {
    id: unit.id,
    label: unit.name,
    factor: Number(unit.factor),
    price: Number(unit.sell_price),
  };
}

/** All sellable units for a product: base unit first, then active extras. */
export function saleUnits(product: UnitBearingProduct): LocalCartUnit[] {
  const extras = (product.units ?? [])
    .filter((unit) => unit.is_active !== false)
    .map(toCartUnit);
  return [baseUnit(product), ...extras];
}

/** Whether a product offers more than just its base unit. */
export function hasMultipleUnits(product: UnitBearingProduct): boolean {
  return (product.units ?? []).some((unit) => unit.is_active !== false);
}

/** Stable identity for a cart line (product + chosen unit). */
export function cartLineKey(productId: number, unitId: number | null): string {
  return `${productId}:${unitId ?? 'base'}`;
}
