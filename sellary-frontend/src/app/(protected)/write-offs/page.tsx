'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { writeOffsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { canAccessModule } from '@/lib/modules';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { ModuleGuard } from '@/components/ModuleGuard';
import { CardSkeleton, TableSkeleton } from '@/components/skeletons';
import QueryError from '@/components/ui/QueryError';
import WriteOffDialog, { type WriteOffPayload } from '@/components/write-offs/WriteOffDialog';
import { REASON_LABELS, REASON_ORDER, dispositionLabel, reasonLabel } from '@/lib/writeOffLabels';
import type { WriteOffListResponse, WriteOffSummary } from '@/lib/types';

const errorText = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => d?.msg).filter(Boolean).join('; ');
  return fallback;
};

export default function WriteOffsPage() {
  const queryClient = useQueryClient();
  const modules = useAuthStore((state) => state.modules ?? {});
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const canEdit = isAdmin || canAccessModule(modules, 'inventory', 'manager');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string>('all');
  const [reason, setReason] = useState<string>('all');

  const filters = {
    limit: 200,
    ...(disposition === 'all' ? {} : { disposition }),
    ...(reason === 'all' ? {} : { reason_code: reason }),
  };

  const list = useQuery<WriteOffListResponse>({
    queryKey: ['writeOffs', 'list', disposition, reason],
    queryFn: async () => (await writeOffsApi.list(filters)).data,
  });

  const summary = useQuery<WriteOffSummary>({
    queryKey: ['writeOffs', 'summary'],
    queryFn: async () => (await writeOffsApi.getSummary()).data,
  });

  const create = useMutation({
    mutationFn: (payload: WriteOffPayload) => writeOffsApi.create(payload),
    onSuccess: () => {
      toast.success('Списано');
      setDialogOpen(false);
      setDialogError(null);
      queryClient.invalidateQueries({ queryKey: ['writeOffs'] });
      // Stock and its valuation just changed.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (error: any) => setDialogError(errorText(error, 'Не удалось списать товар')),
  });

  const rows = list.data?.items ?? [];
  const byDisposition = new Map(
    (summary.data?.by_disposition ?? []).map((bucket) => [bucket.key, bucket.total_cost]),
  );

  return (
    <ModuleGuard module="inventory">
      <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">
              Списания
            </h2>
            <p className="mt-0.5 max-w-[70ch] text-sm text-[var(--erp-muted)]">
              Товар, который испортился, разбился или оказался бракованным. Со склада он
              уходит по себестоимости той партии, из которой пришёл. Возврат поставщику —
              это тот же акт, только с указанием, кто товар забрал; движение денег
              программа при этом не создаёт.
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => {
                setDialogError(null);
                setDialogOpen(true);
              }}
              className="h-10 bg-[var(--erp-accent)] px-4 text-sm font-medium text-white hover:opacity-90"
            >
              Новый акт
            </button>
          )}
        </div>

        {summary.isLoading ? (
          <CardSkeleton />
        ) : summary.isError ? (
          <QueryError what="итоги списаний" onRetry={() => void summary.refetch()} />
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border border-[var(--erp-divider)] bg-white p-4 text-sm dark:bg-gray-800">
            <span className="font-semibold text-[var(--erp-text)] dark:text-white">
              За 30 дней:{' '}
              <strong className="tabular-nums">
                {formatMoney(summary.data?.total_cost ?? '0')}
              </strong>
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Утилизировано:{' '}
              <strong className="tabular-nums">
                {formatMoney(byDisposition.get('disposed') ?? '0')}
              </strong>
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Возвращено поставщику:{' '}
              <strong className="tabular-nums">
                {formatMoney(byDisposition.get('returned_to_supplier') ?? '0')}
              </strong>
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Актов: <strong className="tabular-nums">{summary.data?.document_count ?? 0}</strong>
            </span>
          </div>
        )}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
              Акты списания
            </h3>
            <div className="flex gap-2">
              <select
                value={disposition}
                onChange={(event) => setDisposition(event.target.value)}
                aria-label="Что сделали с товаром"
                className="h-9 border border-[var(--erp-divider)] bg-white px-2 text-sm dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Все акты</option>
                <option value="disposed">Утилизировано</option>
                <option value="returned_to_supplier">Возврат поставщику</option>
              </select>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-label="Причина"
                className="h-9 border border-[var(--erp-divider)] bg-white px-2 text-sm dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Все причины</option>
                {REASON_ORDER.map((code) => (
                  <option key={code} value={code}>
                    {REASON_LABELS[code]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {list.isLoading ? (
            <TableSkeleton />
          ) : list.isError ? (
            <QueryError what="списания" onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
              Списаний пока не было.
            </div>
          ) : (
            <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Что сделали</th>
                    <th className="px-4 py-3">Причина</th>
                    <th className="px-4 py-3">Поставщик</th>
                    <th className="px-4 py-3">Товары</th>
                    <th className="px-4 py-3">Кто</th>
                    <th className="px-4 py-3 text-right">Себестоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((writeOff) => (
                    <tr
                      key={writeOff.id}
                      className="border-b border-[var(--erp-divider)] align-top"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateTime(writeOff.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="bg-[var(--erp-surface)] px-2 py-0.5 text-xs font-medium text-[var(--erp-text)] dark:text-gray-100">
                          {dispositionLabel(writeOff.disposition)}
                        </span>
                      </td>
                      <td className="px-4 py-3">{reasonLabel(writeOff.reason_code)}</td>
                      <td className="px-4 py-3">{writeOff.supplier_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        {writeOff.items.map((item) => (
                          <div key={item.id} className="whitespace-nowrap">
                            {item.product_name} — {item.unit_quantity}{' '}
                            {item.unit_name ?? ''}
                          </div>
                        ))}
                        {writeOff.notes && (
                          <div className="mt-1 text-xs text-[var(--erp-muted)]">
                            {writeOff.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{writeOff.created_by_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(writeOff.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {dialogOpen && (
        <WriteOffDialog
          submitting={create.isPending}
          error={dialogError}
          onClose={() => setDialogOpen(false)}
          onSubmit={(payload) => create.mutate(payload)}
        />
      )}
    </ModuleGuard>
  );
}
