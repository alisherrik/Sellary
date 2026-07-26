'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { moneyApi, shiftsApi } from '@/lib/api';
import { useCurrentShift, useShifts } from '@/hooks/useQueries';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { ShiftTotalsPanel } from '@/components/shifts/ShiftTotalsPanel';
import { CloseShiftForm } from '@/components/shifts/CloseShiftForm';
import { MoneyDialog } from '@/components/finance/MoneyDialog';
import { TableSkeleton } from '@/components/skeletons';
import { ShiftGateBanner } from '@/components/shifts/ShiftGate';

function OpenShiftBlock() {
  const { data: shift } = useCurrentShift();
  const queryClient = useQueryClient();
  const [showClose, setShowClose] = useState(false);
  const [tillDialog, setTillDialog] = useState<'in' | 'out' | null>(null);
  const [tillError, setTillError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['currentShift'] });
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
    queryClient.invalidateQueries({ queryKey: ['money'] });
  };

  // The till account and the reason list; the dialog needs both, and the
  // cashier reaches this page far more often than /finance.
  const accounts = useQuery({
    queryKey: ['money', 'accounts'],
    queryFn: async () => (await moneyApi.getAccounts()).data,
  });
  const reasons = useQuery({
    queryKey: ['money', 'reasons'],
    queryFn: async () => (await moneyApi.getReasons()).data,
    staleTime: Infinity,
  });
  const till = accounts.data?.accounts.find((account) => account.is_till);

  const tillMutation = useMutation({
    mutationFn: (payload: {
      accountId: number;
      direction: 'in' | 'out';
      amount: string;
      reason: string;
      note?: string;
    }) =>
      moneyApi.recordTill({
        account_id: payload.accountId,
        direction: payload.direction,
        amount: payload.amount,
        reason: payload.reason,
        note: payload.note,
      }),
    onSuccess: () => {
      toast.success('Движение записано');
      setTillDialog(null);
      setTillError(null);
      invalidate();
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail;
      setTillError(typeof detail === 'string' ? detail : 'Не удалось записать движение');
    },
  });

  const snapshotMutation = useMutation({
    mutationFn: () => shiftsApi.snapshot(shift!.id),
    onSuccess: () => {
      toast.success('Срез сохранён');
      queryClient.invalidateQueries({ queryKey: ['shift', shift!.id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Не удалось сделать срез'),
  });

  const closeMutation = useMutation({
    mutationFn: (countedCash: string) => shiftsApi.close(shift!.id, countedCash),
    onSuccess: () => {
      toast.success('Смена закрыта');
      setShowClose(false);
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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setTillError(null);
              setTillDialog('in');
            }}
            className="h-9 border border-[var(--erp-divider)] bg-white px-4 text-sm font-medium text-[var(--erp-text)] hover:border-[var(--erp-text)]"
          >
            Внести
          </button>
          <button
            onClick={() => {
              setTillError(null);
              setTillDialog('out');
            }}
            className="h-9 border border-[var(--erp-divider)] bg-white px-4 text-sm font-medium text-[var(--erp-text)] hover:border-[var(--erp-text)]"
          >
            Изъять
          </button>
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
        <CloseShiftForm
          shift={shift}
          totals={shift.totals}
          submitting={closeMutation.isPending}
          onCancel={() => setShowClose(false)}
          onConfirm={(countedCash) => closeMutation.mutate(countedCash)}
        />
      )}

      {tillDialog && till && (
        <MoneyDialog
          mode={tillDialog}
          accounts={[till]}
          reasons={reasons.data}
          defaultAccountId={till.id}
          submitting={tillMutation.isPending}
          error={tillError}
          onClose={() => {
            setTillDialog(null);
            setTillError(null);
          }}
          onSubmit={(payload) =>
            tillMutation.mutate({
              accountId: payload.accountId,
              direction: payload.mode as 'in' | 'out',
              amount: payload.amount,
              reason: payload.reason!,
              note: payload.note,
            })
          }
        />
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
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(revenue)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${disc < 0 ? 'text-[#dc2626]' : disc > 0 ? 'text-[var(--erp-success)]' : 'text-[var(--erp-muted)]'}`}>
                        {formatMoney(s.discrepancy ?? '0')}
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
