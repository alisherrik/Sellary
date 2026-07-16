'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { shiftsApi } from '@/lib/api';
import { useCurrentShift, useShifts } from '@/hooks/useQueries';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ShiftTotalsPanel } from '@/components/shifts/ShiftTotalsPanel';
import { TableSkeleton } from '@/components/skeletons';

function OpenShiftBlock() {
  const { data: shift } = useCurrentShift();
  const queryClient = useQueryClient();
  const [countedCash, setCountedCash] = useState('');
  const [showClose, setShowClose] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['currentShift'] });
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
  };

  const snapshotMutation = useMutation({
    mutationFn: () => shiftsApi.snapshot(shift!.id),
    onSuccess: () => {
      toast.success('Срез сохранён');
      queryClient.invalidateQueries({ queryKey: ['shift', shift!.id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Не удалось сделать срез'),
  });

  const closeMutation = useMutation({
    mutationFn: () => shiftsApi.close(shift!.id, countedCash || '0'),
    onSuccess: () => {
      toast.success('Смена закрыта');
      setShowClose(false);
      setCountedCash('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Не удалось закрыть смену'),
  });

  if (!shift) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        Смена не открыта. Откройте смену на странице кассы, чтобы начать продажи.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Смена №{shift.shift_number} — открыта
          </p>
          <p className="text-xs text-gray-500">c {formatDateTime(shift.opened_at)}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => snapshotMutation.mutate()}
            disabled={snapshotMutation.isPending}
            className="h-9 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800"
          >
            Срез
          </button>
          <button
            onClick={() => setShowClose((v) => !v)}
            className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
          >
            Закрыть смену
          </button>
        </div>
      </div>

      <ShiftTotalsPanel shift={shift} totals={shift.totals} />

      {showClose && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 dark:bg-gray-800">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Посчитанные наличные в кассе</label>
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              placeholder={String(shift.totals.expected_cash)}
              className="h-9 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-600 dark:bg-gray-700"
            />
          </div>
          <button
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending || countedCash === ''}
            className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            Подтвердить закрытие
          </button>
        </div>
      )}
    </div>
  );
}

export default function ShiftsPage() {
  const { data: shifts = [], isLoading } = useShifts({ limit: 100 });
  const closedShifts = shifts.filter((s) => s.status === 'closed');

  return (
    <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
      <OpenShiftBlock />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Закрытые смены</h2>
        {isLoading ? (
          <TableSkeleton />
        ) : closedShifts.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800">
            Пока нет закрытых смен.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-400 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3">Смена</th>
                  <th className="px-4 py-3">Открыта</th>
                  <th className="px-4 py-3">Закрыта</th>
                  <th className="px-4 py-3 text-right">Выручка</th>
                  <th className="px-4 py-3 text-right">Расхождение</th>
                </tr>
              </thead>
              <tbody>
                {closedShifts.map((s) => {
                  const revenue =
                    Number(s.totals.cash_sales) +
                    Number(s.totals.card_sales) +
                    Number(s.totals.mobile_sales) +
                    Number(s.totals.credit_sales);
                  const disc = s.discrepancy != null ? Number(s.discrepancy) : 0;
                  return (
                    <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                      <td className="px-4 py-3">
                        <Link href={`/shifts/${s.id}`} className="font-medium text-blue-600 hover:underline">
                          №{s.shift_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(s.opened_at)}</td>
                      <td className="px-4 py-3 text-gray-500">{s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(revenue)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${disc < 0 ? 'text-red-600' : disc > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {formatCurrency(s.discrepancy ?? '0')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
