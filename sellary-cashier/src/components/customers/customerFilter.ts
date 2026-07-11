import type { CustomerWithBalance } from '../../lib/db';

export type DebtFilter = 'all' | 'debt' | 'clear';

/** A customer owes money iff their read-time derived local balance is positive (§2.4). */
export function hasDebt(c: CustomerWithBalance): boolean {
  return Number(c.local_balance || 0) > 0;
}

/** Tab counts over the FULL list (not the currently-visible subset). */
export function debtCounts(list: CustomerWithBalance[]): { all: number; debt: number; clear: number } {
  let debt = 0;
  for (const c of list) if (hasDebt(c)) debt += 1;
  return { all: list.length, debt, clear: list.length - debt };
}

/** Apply the active debt tab + a free-text search over name/phone/description. */
export function filterCustomers(
  list: CustomerWithBalance[],
  filter: DebtFilter,
  search: string,
): CustomerWithBalance[] {
  const q = search.trim().toLowerCase();
  return list.filter((c) => {
    if (filter === 'debt' && !hasDebt(c)) return false;
    if (filter === 'clear' && hasDebt(c)) return false;
    if (q) {
      const hay = `${c.name} ${c.phone ?? ''} ${c.description ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
