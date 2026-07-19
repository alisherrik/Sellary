// Currency symbol shown in the marketplace. The platform is single-currency
// for now (Tajik somoni); change this one constant to re-currency the shop.
export const CURRENCY_SYMBOL = 'с.';

/** Format a price (number) as "1 500 с." with space thousands separator. */
export function formatPrice(amount: number): string {
  const parts = Math.round(amount).toString().split('');
  const result: string[] = [];
  parts.reverse().forEach((d, i) => {
    if (i > 0 && i % 3 === 0) result.push(' ');
    result.push(d);
  });
  return result.reverse().join('') + ' ' + CURRENCY_SYMBOL;
}
