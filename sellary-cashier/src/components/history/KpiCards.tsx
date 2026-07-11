import { formatCurrency } from '../../lib/format';

export function KpiCards({
  turnover,
  count,
  unsynced,
  onUnsyncedClick,
}: {
  turnover: number;
  count: number;
  unsynced: number;
  onUnsyncedClick: () => void;
}) {
  const avg = count > 0 ? turnover / count : 0;
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">Оборот</p>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{formatCurrency(turnover)}</p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">Чеков</p>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{count}</p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">Средний чек</p>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{formatCurrency(avg)}</p>
      </div>
      <button
        type="button"
        onClick={onUnsyncedClick}
        className={`rounded-2xl p-4 text-left shadow-sm transition-colors ${
          unsynced > 0
            ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'
            : 'border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800'
        }`}
      >
        <p className={`text-xs ${unsynced > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
          Не синхронизировано
        </p>
        <p className={`text-xl font-bold tabular-nums sm:text-2xl ${unsynced > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>
          {unsynced}
        </p>
      </button>
    </div>
  );
}
