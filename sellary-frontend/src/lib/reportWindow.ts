/**
 * The first day of an «за N дней» window, as an instant.
 *
 * Sent explicitly because the server floors a MISSING start at the
 * reconciliation cut-off — which is how a сверка made «за 90 дней» quietly mean
 * «с даты сверки». The end is deliberately left to the server: it knows the
 * company timezone and the browser does not.
 */
export function windowStart(days: number, now: Date = new Date()): string {
  const first = new Date(now);
  first.setDate(first.getDate() - Math.max(days - 1, 0));
  first.setHours(0, 0, 0, 0);
  return first.toISOString();
}
