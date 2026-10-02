import type { InventoryLog } from '@/lib/types';

export type Direction = 'all' | 'up' | 'down';

export interface StocktakeFilters {
  from: string;
  to: string;
  reason: string;
  user: string;
  direction: Direction;
  search: string;
}

export interface ProductGroup {
  product_id: number;
  product_name: string;
  count: number;
  quantity_change: number;
  value_change: number;
  last_at: string;
  rows: InventoryLog[];
}

/**
 * The row's own calendar day, as `YYYY-MM-DD`.
 *
 * Deliberately the browser's clock: it is the clock the row's timestamp is
 * rendered on beside it, so the filter can never disagree with the date the
 * user is reading.
 */
const localDay = (value: string) => {
  const at = new Date(value);
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
};

export function applyFilters(
  rows: InventoryLog[],
  filters: StocktakeFilters,
): InventoryLog[] {
  const needle = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (needle && !row.product_name.toLowerCase().includes(needle)) return false;
    if (filters.reason !== 'all' && row.reference_type !== filters.reason) return false;
    if (filters.user !== 'all' && row.user_name !== filters.user) return false;

    const change = Number(row.quantity_change);
    if (filters.direction === 'up' && change <= 0) return false;
    if (filters.direction === 'down' && change >= 0) return false;

    const day = localDay(row.created_at);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;

    return true;
  });
}

/** One row per product, most-corrected first — that ordering is the signal. */
export function groupByProduct(rows: InventoryLog[]): ProductGroup[] {
  const groups = new Map<number, ProductGroup>();

  for (const row of rows) {
    const existing = groups.get(row.product_id);
    if (existing) {
      existing.count += 1;
      existing.quantity_change += Number(row.quantity_change);
      existing.value_change += Number(row.value_change);
      existing.rows.push(row);
      if (row.created_at > existing.last_at) existing.last_at = row.created_at;
    } else {
      groups.set(row.product_id, {
        product_id: row.product_id,
        product_name: row.product_name,
        count: 1,
        quantity_change: Number(row.quantity_change),
        value_change: Number(row.value_change),
        last_at: row.created_at,
        rows: [row],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at),
  );
}
