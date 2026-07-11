import { remainingStock } from './posStock';

export type StockTone = 'ok' | 'empty' | 'oversold';

export interface StockBadge {
  tone: StockTone;
  label: string;
}

/**
 * Grid tile stock badge (§5.4 / §9). Overselling is tolerated (an offline sale
 * is a historical fact), so tiles stay clickable; the badge only signals state.
 *   stock < 0  → red    "-N uom"      (перерасход)
 *   left  <= 0 → amber  "нет"/"в корзине"
 *   left  > 0  → emerald "N uom"
 */
export function stockBadge(
  stockQuantity: number,
  uom: string,
  qtyInCart: number,
): StockBadge {
  if (stockQuantity < 0) {
    return { tone: 'oversold', label: `${stockQuantity} ${uom}` };
  }
  const left = remainingStock(stockQuantity, qtyInCart);
  if (left <= 0) {
    return { tone: 'empty', label: qtyInCart > 0 ? 'в корзине' : 'нет' };
  }
  return { tone: 'ok', label: `${left} ${uom}` };
}

/** True when adding one more base unit drives the resulting stock to/below zero. */
export function willOversell(stockQuantity: number, qtyInCart: number): boolean {
  return stockQuantity - (qtyInCart + 1) <= 0;
}
