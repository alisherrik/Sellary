import { describe, expect, it } from 'vitest';
import type { InventoryLog } from '@/lib/types';
import { applyFilters, groupByProduct } from '../stocktakeHistory';

const log = (over: Partial<InventoryLog> = {}): InventoryLog => ({
  id: 1,
  product_id: 4,
  product_name: 'Сахар 1кг',
  user_id: 2,
  user_name: 'Shohrom',
  quantity_change: '-2.000',
  value_change: '-10.00',
  previous_quantity: '10.000',
  new_quantity: '8.000',
  reason: null,
  reference_type: 'shortage',
  reference_id: null,
  created_at: '2026-08-14T09:00:00Z',
  ...over,
});

const NO_FILTERS = {
  from: '',
  to: '',
  reason: 'all',
  user: 'all',
  direction: 'all' as const,
  search: '',
};

describe('applyFilters', () => {
  it('keeps everything when nothing is set', () => {
    const rows = [log(), log({ id: 2, reference_type: 'surplus' })];

    expect(applyFilters(rows, NO_FILTERS)).toHaveLength(2);
  });

  it('matches the product name case-insensitively', () => {
    const rows = [log(), log({ id: 2, product_name: 'Курут Танга' })];

    const found = applyFilters(rows, { ...NO_FILTERS, search: 'сахар' });

    expect(found.map((row) => row.id)).toEqual([1]);
  });

  it('filters by reason', () => {
    const rows = [log(), log({ id: 2, reference_type: 'surplus' })];

    const found = applyFilters(rows, { ...NO_FILTERS, reason: 'surplus' });

    expect(found.map((row) => row.id)).toEqual([2]);
  });

  it('filters by who did it', () => {
    const rows = [log(), log({ id: 2, user_name: 'Алишер' })];

    const found = applyFilters(rows, { ...NO_FILTERS, user: 'Алишер' });

    expect(found.map((row) => row.id)).toEqual([2]);
  });

  it('splits излишек from недостача on the sign', () => {
    const rows = [log(), log({ id: 2, quantity_change: '3.000' })];

    expect(applyFilters(rows, { ...NO_FILTERS, direction: 'up' }).map((r) => r.id)).toEqual([2]);
    expect(applyFilters(rows, { ...NO_FILTERS, direction: 'down' }).map((r) => r.id)).toEqual([1]);
  });

  it('includes both ends of the date range', () => {
    const rows = [
      log({ id: 1, created_at: '2026-08-13T14:00:00Z' }),
      log({ id: 2, created_at: '2026-08-14T09:00:00Z' }),
      log({ id: 3, created_at: '2026-08-15T09:00:00Z' }),
    ];

    const found = applyFilters(rows, {
      ...NO_FILTERS,
      from: '2026-08-14',
      to: '2026-08-15',
    });

    expect(found.map((row) => row.id).sort()).toEqual([2, 3]);
  });

  it('combines filters', () => {
    const rows = [
      log({ id: 1, reference_type: 'surplus', quantity_change: '3.000' }),
      log({ id: 2, reference_type: 'surplus', quantity_change: '-3.000' }),
    ];

    const found = applyFilters(rows, {
      ...NO_FILTERS,
      reason: 'surplus',
      direction: 'up',
    });

    expect(found.map((row) => row.id)).toEqual([1]);
  });
});

describe('groupByProduct', () => {
  it('sums the changes per product', () => {
    const rows = [
      log({ id: 1, quantity_change: '-2.000', value_change: '-10.00' }),
      log({ id: 2, quantity_change: '-3.000', value_change: '-15.00' }),
    ];

    const [group] = groupByProduct(rows);

    expect(group.product_id).toBe(4);
    expect(group.count).toBe(2);
    expect(group.quantity_change).toBeCloseTo(-5);
    expect(group.value_change).toBeCloseTo(-25);
  });

  it('orders the most-corrected product first', () => {
    const rows = [
      log({ id: 1, product_id: 4, product_name: 'Сахар' }),
      log({ id: 2, product_id: 9, product_name: 'Курут' }),
      log({ id: 3, product_id: 9, product_name: 'Курут' }),
    ];

    expect(groupByProduct(rows).map((group) => group.product_id)).toEqual([9, 4]);
  });

  it('reports the latest count as the product date', () => {
    const rows = [
      log({ id: 1, created_at: '2026-08-10T09:00:00Z' }),
      log({ id: 2, created_at: '2026-08-14T09:00:00Z' }),
    ];

    expect(groupByProduct(rows)[0].last_at).toBe('2026-08-14T09:00:00Z');
  });

  it('carries the rows so a row can expand without refetching', () => {
    const rows = [log({ id: 1 }), log({ id: 2 })];

    expect(groupByProduct(rows)[0].rows.map((row) => row.id)).toEqual([1, 2]);
  });
});
