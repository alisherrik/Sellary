/** Cashier currency formatter — UZS, ru-RU grouping, no fractional soum. */
export function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const value = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'UZS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
