// Half-up with a tolerance, because binary error otherwise tips ties the wrong
// way: 0.5 × 19.99 is 9.994999999999999, so a plain Math.round gives 9.99 while
// the server — which quantizes half-up on exact decimals — charges 10.00. On
// weighed goods, the case this till exists for, that is a drawer that does not
// match the screen. The tolerance is far below a cent and far above float noise.
const ROUND_TOLERANCE = 1e-9;
const roundMoney = (value: number) =>
  Math.round(value * 100 + Math.sign(value) * ROUND_TOLERANCE) / 100;

/** Prices carry 4 decimals server-side; quantities 3. */
export const toPricePrecision = (value: number) => Number(value.toFixed(4));
export const toQuantityPrecision = (value: number) => Number(value.toFixed(3));

export function formatEditableAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(roundMoney(value));
}

export function parseEditableAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateCashPayment(value: string, total: number) {
  const parsedReceived = parseEditableAmount(value);
  const roundedTotal = roundMoney(Math.max(0, total));

  if (parsedReceived === null || parsedReceived < 0) {
    return {
      received: null,
      change: 0,
      shortfall: roundedTotal,
      isSufficient: false,
    };
  }

  const received = roundMoney(parsedReceived);
  const difference = roundMoney(received - roundedTotal);

  return {
    received,
    change: difference > 0 ? difference : 0,
    shortfall: difference < 0 ? Math.abs(difference) : 0,
    isSufficient: difference >= 0,
  };
}

export function calculateCreditInitialPayment(value: string, total: number) {
  const parsed = parseEditableAmount(value);
  const roundedTotal = roundMoney(Math.max(0, total));
  const amount = parsed === null ? 0 : roundMoney(Math.max(0, parsed));
  const exceedsTotal = amount > roundedTotal;

  return {
    amount,
    remaining: roundMoney(Math.max(0, roundedTotal - amount)),
    exceedsTotal,
    isValid: !exceedsTotal,
  };
}

export function calculateDiscountFromEditedPrice(value: string, originalPrice: number): number {
  const editedPrice = parseEditableAmount(value);
  if (editedPrice === null || editedPrice < 0) {
    return 0;
  }

  return roundMoney(originalPrice - editedPrice);
}

export function calculatePosPricing({
  subtotal,
  tax,
  itemDiscounts,
  overallDiscount,
}: {
  subtotal: number;
  tax: number;
  itemDiscounts: number;
  overallDiscount: number;
}) {
  const totalBeforeDiscount = roundMoney(subtotal + tax);
  const totalDiscount = roundMoney(itemDiscounts + overallDiscount);
  const finalTotal = roundMoney(Math.max(0, totalBeforeDiscount - totalDiscount));

  return {
    totalBeforeDiscount,
    totalDiscount,
    finalTotal,
  };
}

/**
 * The register total, computed the way the server computes it.
 *
 * A per-line price edit is a change to the *unit* price — 100 → 90 on a line of
 * three is a 30 discount, not a 10 one. The old math summed those edits once
 * each, so the cart line read 270 while the Register Total read 290, and 290
 * was charged. Worse, the same adjustment was sent both per item and again in
 * the sale-level discount: the server nets an item discount into the line total
 * *and* pro-rates the sale discount back onto every line, so a discounted sale
 * refunded less than the customer paid.
 *
 * One rule now: the adjustment lives in the unit price, and travels to the
 * server as the unit price. Subtotal, tax and total then follow from it on both
 * sides, so the two cannot disagree — including on tax, which the server always
 * charged on the adjusted base while the client taxed the original.
 *
 * `discount` on a cart line is per unit and signed: positive is a discount,
 * negative a markup.
 */
export interface PricedCartLine {
  quantity: number;
  discount?: number;
  taxPercent: number;
  unitPrice: number;
}

export function calculateCartTotals(lines: PricedCartLine[], overallDiscount = 0) {
  let subtotal = 0;
  let tax = 0;
  let itemAdjustments = 0;

  for (const line of lines) {
    const adjustment = line.discount || 0;
    const adjustedUnitPrice = line.unitPrice - adjustment;
    const lineSubtotal = roundMoney(adjustedUnitPrice * line.quantity);

    subtotal += lineSubtotal;
    tax += roundMoney((lineSubtotal * line.taxPercent) / 100);
    itemAdjustments += roundMoney(adjustment * line.quantity);
  }

  subtotal = roundMoney(subtotal);
  tax = roundMoney(tax);

  const totalBeforeDiscount = roundMoney(subtotal + tax);
  const finalTotal = roundMoney(Math.max(0, totalBeforeDiscount - overallDiscount));

  return {
    subtotal,
    tax,
    /** Positive when the lines were discounted, negative when marked up. Display only. */
    itemAdjustments: roundMoney(itemAdjustments),
    totalBeforeDiscount,
    overallDiscount: roundMoney(overallDiscount),
    finalTotal,
  };
}
