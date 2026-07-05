/**
 * POS stock helpers — the single source of truth for "how much can still be sold".
 *
 * All quantities here are in the product's BASE unit (the unit `stock_quantity`
 * is denominated in). The multi-UOM work converts a chosen unit to base units
 * before calling these, so the rules stay in one place.
 */

// Guards against float dust (e.g. 0.1 + 0.2) when comparing decimal quantities.
const EPSILON = 1e-9;

/** Base units of a product still available, given how many are already in the cart. */
export function remainingStock(stockQuantity: number | string, qtyInCart: number): number {
  return Math.max(0, Number(stockQuantity) - qtyInCart);
}

/** Quantity added by a catalog tile: one base unit, or the smaller positive remainder. */
export function nextAddQuantity(
  stockQuantity: number | string,
  qtyInCart: number,
): number {
  const remaining = remainingStock(stockQuantity, qtyInCart);
  return remaining > EPSILON ? Math.min(1, remaining) : 0;
}

/** Can `addQty` more base units be added without exceeding available stock? */
export function canAdd(
  stockQuantity: number | string,
  qtyInCart: number,
  addQty = 1,
): boolean {
  return qtyInCart + addQty <= Number(stockQuantity) + EPSILON;
}

/** Is a cart quantity already beyond what the stock can cover? */
export function isOverStock(stockQuantity: number | string, qty: number): boolean {
  return qty > Number(stockQuantity) + EPSILON;
}
