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
import { ShiftGateBanner } from '@/components/shifts/ShiftGate';

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
    // The page a manager opens to manage shifts used to tell them to go
    // somewhere else to open one. The control already existed — it just was
    // not mounted here.
    return <ShiftGateBanner />;
  }

  return (
    <div className="border border-[var(--erp-divider)] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--erp-success)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--erp-text)]">
              Смена №{shift.shift_number} — открыта
            </p>
            <p className="text-xs text-gray-500">c {formatDateTime(shift.opened_at)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => snapshotMutation.mutate()}
            disabled={snapshotMutation.isPending}
            className="h-9 border border-[var(--erp-divider)] bg-white px-4 text-sm font-medium text-[var(--erp-text)] hover:border-[var(--erp-text)] disabled:opacity-60"
          >
            Срез
          </button>
          <button
            onClick={() => setShowClose((v) => !v)}
            className="h-9 bg-[var(--erp-accent)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Закрыть смену
          </button>
        </div>
      </div>

      <ShiftTotalsPanel shift={shift} totals={shift.totals} />

      {showClose && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-3">
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
              className="h-9 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm"
            />
          </div>
          <button
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending || countedCash === ''}
            className="h-9 bg-[var(--erp-accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
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
      <div>
        <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Смена</h2>
      </div>

      <OpenShiftBlock />

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Закрытые смены</h3>
        {isLoading ? (
          <TableSkeleton />
        ) : closedShifts.length === 0 ? (
          <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)]">
            Пока нет закрытых смен.
          </div>
        ) : (
          <div className="overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
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
                    <tr key={s.id} className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]">
                      <td className="px-4 py-3">
                        <Link href={`/shifts/${s.id}`} className="font-medium text-[var(--erp-accent)] hover:underline">
                          №{s.shift_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(s.opened_at)}</td>
                      <td className="px-4 py-3 text-gray-500">{s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(revenue)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${disc < 0 ? 'text-[var(--erp-accent)]' : disc > 0 ? 'text-[var(--erp-success)]' : 'text-[var(--erp-muted)]'}`}>
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
