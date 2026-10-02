'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { inventoryApi } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { STOCK_MOVEMENT_LABELS } from '@/lib/stockMovements';
import {
  applyFilters,
  groupByProduct,
  type Direction,
  type StocktakeFilters,
} from '@/lib/stocktakeHistory';
import { formatCurrency } from '@/lib/utils';
import { CardSkeleton } from '@/components/skeletons';
import FilterMenu from '@/components/filters/FilterMenu';
import QueryError from '@/components/ui/QueryError';
import { ModuleGuard } from '@/components/ModuleGuard';
import type { InventoryLog } from '@/lib/types';

// The endpoint's ceiling. A full count of a 485-product catalogue is 485 rows,
// so this is roughly two years of monthly counts — and when it is reached the
// page says so rather than truncating in silence.
const ROW_CAP = 1000;

const REASONS = ['stocktake', 'surplus', 'shortage', 'other', 'manual_adjust'];

const EMPTY: StocktakeFilters = {
  from: '',
  to: '',
  reason: 'all',
  user: 'all',
  direction: 'all',
  search: '',
};

type View = 'list' | 'products';

const signed = (value: number, digits = 3) =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;

const fieldClass =
  'min-h-[40px] w-full border-2 border-[var(--erp-divider)] px-2 text-sm text-[var(--erp-text)] focus:border-[var(--erp-accent)] focus:outline-none';

function Stocktakes() {
  const [view, setView] = useState<View>('list');
  const [filters, setFilters] = useState<StocktakeFilters>(EMPTY);
  const [searchInput, setSearchInput] = useState('');
  const [openProductId, setOpenProductId] = useState<number | null>(null);
  const search = useDebounce(searchInput, 300);

  const query = useQuery<InventoryLog[]>({
    queryKey: ['stocktakes'],
    queryFn: async () =>
      (await inventoryApi.getLogs({ stocktake_only: true, limit: ROW_CAP })).data,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(
    () => applyFilters(rows, { ...filters, search }),
    [rows, filters, search],
  );
  const groups = useMemo(() => groupByProduct(filtered), [filtered]);
  const users = useMemo(
    () => [...new Set(rows.map((row) => row.user_name))].sort(),
    [rows],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          quantity: sum.quantity + Number(row.quantity_change),
          value: sum.value + Number(row.value_change),
        }),
        { quantity: 0, value: 0 },
      ),
    [filtered],
  );

  const activeCount = [
    filters.from || filters.to,
    filters.reason !== 'all',
    filters.user !== 'all',
    filters.direction !== 'all',
  ].filter(Boolean).length;

  const set = <K extends keyof StocktakeFilters>(key: K, value: StocktakeFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="h-full space-y-4 overflow-y-auto mobile-no-overscroll p-4">
      <div>
        <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">
          Инвентаризация
        </h2>
        <p className="mt-0.5 max-w-[70ch] text-sm text-[var(--erp-muted)]">
          Каждый пересчёт остатка: что насчитали, на сколько это разошлось с учётом
          и кто считал. Товар, который правят чаще других, стоит первым во вкладке
          «По товарам».
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Поиск по товару"
          aria-label="Поиск по товару"
          className="min-h-[40px] w-full max-w-xs border-2 border-[var(--erp-divider)] px-3 text-sm text-[var(--erp-text)] focus:border-[var(--erp-accent)] focus:outline-none"
        />

        <FilterMenu
          activeCount={activeCount}
          onReset={() => setFilters(EMPTY)}
          className="ml-auto"
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]">
                Период
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="date"
                  aria-label="С даты"
                  value={filters.from}
                  onChange={(event) => set('from', event.target.value)}
                  className={fieldClass}
                />
                <input
                  type="date"
                  aria-label="По дату"
                  value={filters.to}
                  onChange={(event) => set('to', event.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="stocktake-reason"
                className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]"
              >
                Причина
              </label>
              <select
                id="stocktake-reason"
                value={filters.reason}
                onChange={(event) => set('reason', event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="all">Все</option>
                {REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {STOCK_MOVEMENT_LABELS[reason] ?? reason}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="stocktake-user"
                className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]"
              >
                Кто
              </label>
              <select
                id="stocktake-user"
                value={filters.user}
                onChange={(event) => set('user', event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="all">Все</option>
                {users.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="stocktake-direction"
                className="text-xs font-bold uppercase tracking-wide text-[var(--erp-muted)]"
              >
                Направление
              </label>
              <select
                id="stocktake-direction"
                value={filters.direction}
                onChange={(event) => set('direction', event.target.value as Direction)}
                className={`${fieldClass} mt-1`}
              >
                <option value="all">Все</option>
                <option value="up">Излишек (+)</option>
                <option value="down">Недостача (−)</option>
              </select>
            </div>
          </div>
        </FilterMenu>
      </div>

      {query.isLoading ? (
        <CardSkeleton />
      ) : query.isError ? (
        <QueryError what="инвентаризацию" onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="border-2 border-[var(--erp-divider)] bg-white p-3 text-sm tabular-nums dark:bg-gray-800">
            {filtered.length} пересчётов · {signed(totals.quantity)} ед. ·{' '}
            {formatCurrency(totals.value)}
          </div>

          {rows.length >= ROW_CAP && (
            <div
              role="status"
              className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-3 text-[13px] leading-snug"
            >
              Показаны последние {ROW_CAP} записей — более старые пересчёты сюда не
              попали.
            </div>
          )}

          <div className="flex gap-1 border-b border-[var(--erp-divider)]">
            {([
              ['list', 'Список'],
              ['products', 'По товарам'],
            ] as [View, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`-mb-px h-10 border-b-2 px-4 text-sm font-medium ${
                  view === key
                    ? 'border-[var(--erp-accent)] text-[var(--erp-text)] dark:text-white'
                    : 'border-transparent text-[var(--erp-muted)] hover:text-[var(--erp-text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
              {rows.length === 0
                ? 'Пересчётов остатка ещё не было.'
                : 'Под выбранные фильтры ничего не подошло.'}
            </div>
          ) : view === 'list' ? (
            <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Товар</th>
                    <th className="px-4 py-3">Причина</th>
                    <th className="px-4 py-3 text-right">Было → стало</th>
                    <th className="px-4 py-3 text-right">Разница</th>
                    <th className="px-4 py-3 text-right">Сумма</th>
                    <th className="px-4 py-3">Кто</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const change = Number(row.quantity_change);
                    return (
                      <tr
                        key={row.id}
                        className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--erp-muted)]">
                          {new Date(row.created_at).toLocaleString('ru-RU')}
                        </td>
                        <td className="px-4 py-3 font-medium">{row.product_name}</td>
                        <td className="px-4 py-3">
                          {STOCK_MOVEMENT_LABELS[row.reference_type ?? ''] ?? 'Изменение'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                          {row.previous_quantity} → {row.new_quantity}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                            change < 0 ? 'text-[#dc2626]' : 'text-[var(--erp-success)]'
                          }`}
                        >
                          {signed(change)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {formatCurrency(row.value_change)}
                        </td>
                        <td className="px-4 py-3 text-[var(--erp-muted)]">{row.user_name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div
                  key={group.product_id}
                  className="border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800"
                >
                  <button
                    onClick={() =>
                      setOpenProductId(
                        openProductId === group.product_id ? null : group.product_id,
                      )
                    }
                    aria-expanded={openProductId === group.product_id}
                    className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 p-4 text-left hover:bg-[var(--erp-surface)]"
                  >
                    <span className="font-semibold text-[var(--erp-text)]">
                      {group.product_name}
                    </span>
                    <span className="text-xs text-[var(--erp-muted)]">
                      {group.count} пересчётов
                    </span>
                    <span
                      className={`ml-auto text-sm font-semibold tabular-nums ${
                        group.quantity_change < 0
                          ? 'text-[#dc2626]'
                          : 'text-[var(--erp-success)]'
                      }`}
                    >
                      {signed(group.quantity_change)} ед.
                    </span>
                    <span className="text-sm tabular-nums">
                      {formatCurrency(group.value_change)}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--erp-muted)]">
                      {new Date(group.last_at).toLocaleDateString('ru-RU')}
                    </span>
                  </button>

                  {openProductId === group.product_id && (
                    <ol className="space-y-2 border-t border-[var(--erp-divider)] p-4">
                      {group.rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-[var(--erp-divider)] p-3 text-sm"
                        >
                          <span className="tabular-nums text-[var(--erp-muted)]">
                            {new Date(row.created_at).toLocaleString('ru-RU')}
                          </span>
                          <span>
                            {STOCK_MOVEMENT_LABELS[row.reference_type ?? ''] ?? 'Изменение'}
                          </span>
                          <span className="tabular-nums text-[var(--erp-muted)]">
                            {row.previous_quantity} → {row.new_quantity}
                          </span>
                          <span
                            className={`font-semibold tabular-nums ${
                              Number(row.quantity_change) < 0
                                ? 'text-[#dc2626]'
                                : 'text-[var(--erp-success)]'
                            }`}
                          >
                            {signed(Number(row.quantity_change))}
                          </span>
                          <span className="text-[var(--erp-muted)]">{row.user_name}</span>
                          {row.reason && (
                            <span className="w-full text-[var(--erp-text)]">{row.reason}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function StocktakesPage() {
  return (
    <ModuleGuard module="inventory">
      <Stocktakes />
    </ModuleGuard>
  );
}
