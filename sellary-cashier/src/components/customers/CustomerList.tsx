import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type { CustomerWithBalance } from '../../lib/db';
import { formatCurrency } from '../../lib/format';
import { SyncStatusBadge } from '../history/SyncStatusBadge';
import { DebtFilterTabs } from './DebtFilterTabs';
import type { DebtFilter } from './customerFilter';

export function CustomerList({
  customers,
  selectedClientId,
  onSelect,
  search,
  onSearch,
  filter,
  onFilter,
  counts,
  loading,
}: {
  customers: CustomerWithBalance[];
  selectedClientId: string | null;
  onSelect: (c: CustomerWithBalance) => void;
  search: string;
  onSearch: (v: string) => void;
  filter: DebtFilter;
  onFilter: (f: DebtFilter) => void;
  counts: { all: number; debt: number; clear: number };
  loading: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="space-y-3 border-b border-gray-100 p-3 dark:border-gray-700">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            aria-label="Поиск клиентов"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Поиск по имени или телефону…"
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
          />
        </div>
        <DebtFilterTabs value={filter} onChange={onFilter} counts={counts} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Загрузка клиентов…</div>
        ) : customers.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">Клиентов пока нет</div>
        ) : (
          <div className="space-y-2">
            {customers.map((c) => {
              const selected = c.client_customer_id === selectedClientId;
              const balance = Number(c.local_balance || 0);
              return (
                <button
                  key={c.client_customer_id}
                  type="button"
                  onClick={() => onSelect(c)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                    selected
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
                      : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gray-900 text-sm font-black text-white">
                    {(c.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-gray-900 dark:text-white">{c.name}</p>
                    {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
                    {c.sync_status !== 'synced' && (
                      <span className="mt-1 inline-block">
                        <SyncStatusBadge syncStatus={c.sync_status} errorKind={c.error_kind} />
                      </span>
                    )}
                  </div>
                  <span className={`shrink-0 font-black tabular-nums ${balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {formatCurrency(balance)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
