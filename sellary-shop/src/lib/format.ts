/** Format a price (number) as "1 500 ₽" with space thousands separator. */
export function formatPrice(amount: number): string {
  const parts = Math.round(amount).toString().split('');
  const result: string[] = [];
  parts.reverse().forEach((d, i) => {
    if (i > 0 && i % 3 === 0) result.push(' ');
    result.push(d);
  });
  return result.reverse().join('') + ' ₽';
}
