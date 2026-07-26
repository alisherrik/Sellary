'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { moneyApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { canAccessModule } from '@/lib/modules';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { CardSkeleton, TableSkeleton } from '@/components/skeletons';
import QueryError from '@/components/ui/QueryError';
import { MoneyDialog, type MoneyDialogMode } from '@/components/finance/MoneyDialog';
import type { MoneyOverview, MoneyMovement, MovementReasons } from '@/lib/types';

const errorText = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => d?.msg).filter(Boolean).join('; ');
  return fallback;
};

export default function FinancePage() {
  const queryClient = useQueryClient();
  const modules = useAuthStore((state) => state.modules ?? {});
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const canEdit = isAdmin || canAccessModule(modules, 'finance', 'manager');

  const [dialog, setDialog] = useState<{ mode: MoneyDialogMode; accountId?: number } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<number | 'all'>('all');

  const overview = useQuery<MoneyOverview>({
    queryKey: ['money', 'accounts'],
    queryFn: async () => (await moneyApi.getAccounts()).data,
  });

  const reasons = useQuery<MovementReasons>({
    queryKey: ['money', 'reasons'],
    queryFn: async () => (await moneyApi.getReasons()).data,
    staleTime: Infinity,
  });

  const movements = useQuery<MoneyMovement[]>({
    queryKey: ['money', 'movements', accountFilter],
    queryFn: async () =>
      (
        await moneyApi.getMovements(
          accountFilter === 'all' ? { limit: 200 } : { account_id: accountFilter, limit: 200 },
        )
      ).data,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['money'] });
    // The till balance is part of the shift's arithmetic.
    queryClient.invalidateQueries({ queryKey: ['currentShift'] });
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
  };

  const submit = useMutation({
    mutationFn: async (payload: {
      mode: MoneyDialogMode;
      accountId: number;
      toAccountId?: number;
      amount: string;
      reason?: string;
      note?: string;
    }) => {
      if (payload.mode === 'transfer') {
        return moneyApi.transfer({
          from_account_id: payload.accountId,
          to_account_id: payload.toAccountId!,
          amount: payload.amount,
          note: payload.note,
        });
      }
      if (payload.mode === 'correct') {
        return moneyApi.correct({
          account_id: payload.accountId,
          actual_balance: payload.amount,
          note: payload.note,
        });
      }
      return moneyApi.record({
        account_id: payload.accountId,
        direction: payload.mode,
        amount: payload.amount,
        reason: payload.reason!,
        note: payload.note,
      });
    },
    onSuccess: () => {
      toast.success('Записано');
      setDialog(null);
      setDialogError(null);
      refresh();
    },
    onError: (error: any) => setDialogError(errorText(error, 'Не удалось записать движение')),
  });

  const accounts = overview.data?.accounts ?? [];

  return (
    <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
      <div>
        <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Деньги</h2>
        <p className="mt-0.5 text-sm text-[var(--erp-muted)]">
          Где сейчас деньги магазина и каждое их движение. Продажи и возвраты сюда
          попадают сами — записывать нужно только то, что программа увидеть не может:
          перевод, сдачу в банк, расход.
        </p>
      </div>

      {overview.isLoading ? (
        <CardSkeleton />
      ) : overview.isError ? (
        <QueryError what="счета" onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="border border-[var(--erp-divider)] bg-white p-4 dark:bg-gray-800"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--erp-text)] dark:text-white">
                    {account.name}
                  </p>
                  {account.is_till && (
                    <span className="shrink-0 bg-[var(--erp-surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--erp-muted)]">
                      Ящик
                    </span>
                  )}
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--erp-text)] dark:text-white">
                  {formatMoney(account.balance)}
                </p>
                {canEdit && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => {
                        setDialogError(null);
                        setDialog({ mode: 'in', accountId: account.id });
                      }}
                      className="h-8 border border-[var(--erp-divider)] bg-white px-3 text-xs font-medium hover:border-[var(--erp-text)] dark:bg-gray-800 dark:text-gray-100"
                    >
                      Внести
                    </button>
                    <button
                      onClick={() => {
                        setDialogError(null);
                        setDialog({ mode: 'out', accountId: account.id });
                      }}
                      className="h-8 border border-[var(--erp-divider)] bg-white px-3 text-xs font-medium hover:border-[var(--erp-text)] dark:bg-gray-800 dark:text-gray-100"
                    >
                      Изъять
                    </button>
                    <button
                      onClick={() => {
                        setDialogError(null);
                        setDialog({ mode: 'correct', accountId: account.id });
                      }}
                      className="h-8 border border-[var(--erp-divider)] bg-white px-3 text-xs font-medium hover:border-[var(--erp-text)] dark:bg-gray-800 dark:text-gray-100"
                    >
                      Сверить
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--erp-divider)] bg-white p-4 dark:bg-gray-800">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-gray-600 dark:text-gray-300">
                Наличными:{' '}
                <strong className="tabular-nums">{formatMoney(overview.data?.cash_total ?? '0')}</strong>
              </span>
              <span className="text-gray-600 dark:text-gray-300">
                Безналично:{' '}
                <strong className="tabular-nums">
                  {formatMoney(overview.data?.noncash_total ?? '0')}
                </strong>
              </span>
              <span className="font-semibold text-[var(--erp-text)] dark:text-white">
                Всего:{' '}
                <strong className="tabular-nums">{formatMoney(overview.data?.total ?? '0')}</strong>
              </span>
            </div>
            {canEdit && accounts.length > 1 && (
              <button
                onClick={() => {
                  setDialogError(null);
                  setDialog({ mode: 'transfer' });
                }}
                className="h-10 bg-[var(--erp-accent)] px-4 text-sm font-medium text-white hover:opacity-90"
              >
                Перевод между счетами
              </button>
            )}
          </div>
        </>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
            Движения денег
          </h3>
          <select
            value={accountFilter}
            onChange={(event) =>
              setAccountFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
            }
            aria-label="Счёт"
            className="h-9 border border-[var(--erp-divider)] bg-white px-2 text-sm dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">Все счета</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {movements.isLoading ? (
          <TableSkeleton />
        ) : movements.isError ? (
          <QueryError what="движения" onRetry={() => void movements.refetch()} />
        ) : (movements.data ?? []).length === 0 ? (
          <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
            Движений пока не было. Продажи и возвраты в этот список не попадают — здесь
            только то, что записали вручную: переводы, сдача в банк, расходы.
          </div>
        ) : (
          <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                  <th className="px-4 py-3">Дата</th>
                  <th className="px-4 py-3">Счёт</th>
                  <th className="px-4 py-3">Причина</th>
                  <th className="px-4 py-3">Комментарий</th>
                  <th className="px-4 py-3">Кто</th>
                  <th className="px-4 py-3 text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {(movements.data ?? []).map((movement) => (
                  <tr
                    key={movement.id}
                    className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {formatDateTime(movement.created_at)}
                    </td>
                    <td className="px-4 py-3">{movement.account_name}</td>
                    <td className="px-4 py-3">{movement.reason_label}</td>
                    <td className="px-4 py-3 text-gray-500">{movement.note ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{movement.created_by_name ?? '—'}</td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${
                        movement.direction === 'in'
                          ? 'text-[var(--erp-success)]'
                          : 'text-[#dc2626]'
                      }`}
                    >
                      {movement.direction === 'in' ? '+' : '−'}
                      {formatMoney(movement.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <MoneyDialog
          mode={dialog.mode}
          accounts={accounts}
          reasons={reasons.data}
          defaultAccountId={dialog.accountId}
          submitting={submit.isPending}
          error={dialogError}
          onClose={() => {
            setDialog(null);
            setDialogError(null);
          }}
          onSubmit={(payload) => submit.mutate(payload)}
        />
      )}
    </div>
  );
}
