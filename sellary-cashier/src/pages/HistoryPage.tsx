import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getSalesHistory, getHistoryAggregates } from '../lib/db';
import type { LocalSale, HistoryFilter } from '../lib/db';
import { useSyncStore } from '../lib/sync-store';
import { SyncStatusTabs } from '../components/history/SyncStatusTabs';
import type { SyncFilter } from '../components/history/SyncStatusTabs';
import { FilterMenu } from '../components/history/FilterMenu';
import type { PaymentFilter } from '../components/history/FilterMenu';
import { KpiCards } from '../components/history/KpiCards';
import { HourlyChart } from '../components/history/HourlyChart';
import { SalesTable } from '../components/history/SalesTable';
import { SaleDetailPanel } from '../components/history/SaleDetailPanel';

const PAGE_SIZE = 50;
const EMPTY_AGG = { turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) };

export function HistoryPage() {
  const navigate = useNavigate();
  const { online, needsAttentionCount, isSyncing, syncNow, hasRepeatedFailures } = useSyncStore();

  const [syncFilter, setSyncFilter] = useState<SyncFilter>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentFilter>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [sales, setSales] = useState<LocalSale[]>([]);
  const [aggregates, setAggregates] = useState(EMPTY_AGG);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Canonical HistoryFilter (INDEX §4.5): dateFrom/dateTo (NOT startDate/endDate), and paymentMethod
  // OMITTED for the «Все» tab — never send the literal 'all'. limit/offset are added at each call site.
  const baseOpts = useMemo<Omit<HistoryFilter, 'limit' | 'offset'>>(
    () => ({
      syncFilter,
      paymentMethod: paymentMethod !== 'all' ? paymentMethod : undefined,
      dateFrom: startDate || undefined,
      dateTo: endDate || undefined,
      search: debouncedSearch.trim() || undefined,
    }),
    [syncFilter, paymentMethod, startDate, endDate, debouncedSearch],
  );

  const reqRef = useRef(0);
  useEffect(() => {
    const token = ++reqRef.current;
    setLoading(true);
    Promise.all([
      getSalesHistory({ ...baseOpts, limit: PAGE_SIZE, offset: 0 }),
      // HistoryFilter (INDEX §4.5) requires limit/offset; getHistoryAggregates aggregates over the
      // WHOLE active filter and ignores them — pass placeholders only to satisfy the required shape.
      getHistoryAggregates({ ...baseOpts, limit: PAGE_SIZE, offset: 0 }),
    ]).then(([page, agg]) => {
      if (token !== reqRef.current) return; // stale response
      setSales(page);
      setAggregates(agg);
      setOffset(page.length);
      setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
    });
  }, [baseOpts]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const token = reqRef.current;
    const next = await getSalesHistory({ ...baseOpts, limit: PAGE_SIZE, offset });
    if (token === reqRef.current) {
      setSales((prev) => [...prev, ...next]);
      setOffset((prev) => prev + next.length);
      setHasMore(next.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [baseOpts, offset]);

  const resetFilters = () => {
    setPaymentMethod('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={() => navigate('/cashier')} className="text-sm text-blue-600">← Касса</button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">История продаж</h1>
        {!online && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Оффлайн</span>
        )}
        {/* Non-blocking chip (INDEX §5 / spec §4.7): retries keep running in the background. */}
        {hasRepeatedFailures && (
          <span
            title="Некоторые продажи повторно не отправляются. Автоповтор продолжается."
            className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
          >
            Повторные сбои
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <SyncStatusTabs value={syncFilter} onChange={setSyncFilter} needsAttentionCount={needsAttentionCount} />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по номеру чека…"
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <FilterMenu
                paymentMethod={paymentMethod}
                startDate={startDate}
                endDate={endDate}
                onPaymentMethodChange={setPaymentMethod}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onReset={resetFilters}
              />
              <button
                type="button"
                onClick={() => syncNow()}
                disabled={isSyncing}
                className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <ArrowPathIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{isSyncing ? 'Синхронизация…' : 'Обновить'}</span>
              </button>
            </div>
          </div>

          <KpiCards
            turnover={aggregates.turnover}
            count={aggregates.count}
            unsynced={aggregates.unsynced}
            onUnsyncedClick={() => setSyncFilter('unsynced')}
          />

          <HourlyChart hourly={aggregates.hourly} />

          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {loading ? (
              <div className="p-12 text-center text-gray-400">Загрузка…</div>
            ) : (
              <SalesTable
                sales={sales}
                selectedId={selectedId}
                onRowClick={(s) => setSelectedId(s.id)}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
              />
            )}
          </div>
        </div>

        {selectedId != null && <SaleDetailPanel saleId={selectedId} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
