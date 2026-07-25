import { describe, expect, it } from 'vitest';

import { calculateCartTotals } from '../posPricing';

/**
 * These assertions mirror what services/sale_service.py does with the payload
 * the register sends:
 *   item_subtotal = unit_price × sold_quantity
 *   item_tax      = item_subtotal × tax_percent / 100
 *   total         = Σ subtotal + Σ tax − sale.discount_amount
 * If the client and the server ever disagree here, the customer is charged an
 * amount the register did not show them.
 */
describe('calculateCartTotals', () => {
  it('multiplies a per-unit discount by the quantity', () => {
    // 100 → 90 on a line of three is 30 off, not 10. The old math said 10, so
    // the line read 270 and the total read 290.
    const totals = calculateCartTotals(
      [{ quantity: 3, discount: 10, taxPercent: 0, unitPrice: 100 }],
      0,
    );
    expect(totals.subtotal).toBe(270);
    expect(totals.itemAdjustments).toBe(30);
    expect(totals.finalTotal).toBe(270);
  });

  it('multiplies a markup by the quantity too', () => {
    const totals = calculateCartTotals(
      [{ quantity: 3, discount: -10, taxPercent: 0, unitPrice: 100 }],
      0,
    );
    expect(totals.subtotal).toBe(330);
    expect(totals.itemAdjustments).toBe(-30);
    expect(totals.finalTotal).toBe(330);
  });

  it('taxes the adjusted price, as the server does', () => {
    // The server taxes unit_price, which now carries the adjustment. A client
    // that taxed the original price disagreed with the charge on every
    // discounted line of a taxed product.
    const totals = calculateCartTotals(
      [{ quantity: 2, discount: 20, taxPercent: 10, unitPrice: 100 }],
      0,
    );
    expect(totals.subtotal).toBe(160);
    expect(totals.tax).toBe(16);
    expect(totals.finalTotal).toBe(176);
  });

  it('subtracts the whole-sale discount once, after tax', () => {
    const totals = calculateCartTotals(
      [{ quantity: 1, discount: 0, taxPercent: 10, unitPrice: 100 }],
      30,
    );
    expect(totals.totalBeforeDiscount).toBe(110);
    expect(totals.finalTotal).toBe(80);
  });

  it('never returns a negative total', () => {
    const totals = calculateCartTotals(
      [{ quantity: 1, discount: 0, taxPercent: 0, unitPrice: 50 }],
      500,
    );
    expect(totals.finalTotal).toBe(0);
  });

  it('adds up several lines', () => {
    const totals = calculateCartTotals(
      [
        { quantity: 2, discount: 5, taxPercent: 0, unitPrice: 100 },
        { quantity: 1, discount: 0, taxPercent: 0, unitPrice: 250 },
        { quantity: 3, discount: -10, taxPercent: 0, unitPrice: 20 },
      ],
      0,
    );
    // (95×2) + 250 + (30×3) = 190 + 250 + 90
    expect(totals.subtotal).toBe(530);
    expect(totals.itemAdjustments).toBe(10 - 30);
    expect(totals.finalTotal).toBe(530);
  });

  it('is empty for an empty cart', () => {
    const totals = calculateCartTotals([], 0);
    expect(totals.subtotal).toBe(0);
    expect(totals.finalTotal).toBe(0);
  });
});

describe('payload precision', () => {
  it('rounds a price edit to what the schema accepts', async () => {
    const { toPricePrecision, toQuantityPrecision } = await import('../posPricing');
    // 19.99 − 0.10 is 19.889999999999997 in IEEE-754, and the API rejects
    // anything past four decimals with a 422 the register cannot render.
    expect(toPricePrecision(19.99 - 0.1)).toBe(19.89);
    expect(toPricePrecision(12.35 - 0.05)).toBe(12.3);
    expect(toPricePrecision(7.7 - 0.1)).toBe(7.6);
    expect(toQuantityPrecision(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds half-up on a tie, as the server does', async () => {
    const { calculateCartTotals } = await import('../posPricing');
    // 0.5 × 19.99 = 9.995. Banker's rounding would give 9.99 here and the
    // server 10.00 — a drawer that does not match the screen on weighed goods.
    const totals = calculateCartTotals(
      [{ quantity: 0.5, discount: 0, taxPercent: 0, unitPrice: 19.99 }],
      0,
    );
    expect(totals.subtotal).toBe(10);
  });
});
