import { useCallback, useEffect, useState } from 'react';
import { getSalesHistory, acknowledgeSale } from '../../lib/db';
import type { LocalSale } from '../../lib/db';
import { requestSync } from '../../lib/sync-engine';
import { formatCurrency } from '../../lib/format';

export function NeedsAttentionList() {
  const [rows, setRows] = useState<LocalSale[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const list = await getSalesHistory({ syncFilter: 'attention', limit: 50, offset: 0 });
    setRows(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResend = async (id: number) => {
    setBusyId(id);
    try {
      await requestSync('manual', { force: true });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleAcknowledge = async (id: number) => {
    setBusyId(id);
    try {
      await acknowledgeSale(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (rows.length === 0) {
    return <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-400 dark:border-gray-700">Все продажи синхронизированы.</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map((s) => (
        <div key={s.id} className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">Чек #{s.receipt_no}</span>
            <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(s.total_amount)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">{new Date(s.created_at_client).toLocaleString('ru-RU')}</p>
          {s.last_error && <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{s.last_error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busyId === s.id}
              onClick={() => handleResend(s.id)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Повторить отправку
            </button>
            <button
              type="button"
              disabled={busyId === s.id}
              onClick={() => handleAcknowledge(s.id)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
            >
              Отметить решённым
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
