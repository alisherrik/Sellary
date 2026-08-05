'use client';

import { useQuery } from '@tanstack/react-query';

import { inventoryApi } from '@/lib/api';
import type { InventoryLog } from '@/lib/types';
import { STOCK_MOVEMENT_LABELS } from '@/lib/stockMovements';

/**
 * What one receipt did to the shelf: the sale itself, anything returned
 * against it, and either way of undoing it. The sale panel already says what
 * was charged; this says what actually left and came back.
 */
export default function SaleStockHistory({ saleId }: { saleId: number }) {
  const { data: logs = [], isLoading, isError } = useQuery<InventoryLog[]>({
    queryKey: ['inventoryLogs', 'sale', saleId],
    queryFn: async () => {
      const response = await inventoryApi.getLogs({ sale_id: saleId, limit: 100 });
      return response.data;
    },
  });

  if (isError) return null;

  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-gray-900 dark:text-white">
        Движение остатка
      </p>
      {isLoading ? (
        <p className="py-3 text-center text-[13px] text-[var(--erp-muted)]">Загрузка…</p>
      ) : logs.length === 0 ? (
        <p className="py-3 text-center text-[13px] text-[var(--erp-muted)]">
          Этот чек не двигал остаток
        </p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const change = Number(log.quantity_change);
            return (
              <div
                key={log.id}
                className="flex items-baseline justify-between gap-3 border border-[var(--erp-divider)] p-2 text-[12px]"
              >
                <div className="min-w-0">
                  <p className="truncate text-gray-900 dark:text-white">{log.product_name}</p>
                  <p className="text-[11px] text-[var(--erp-muted)]">
                    {STOCK_MOVEMENT_LABELS[log.reference_type ?? ''] ?? 'Изменение'} ·{' '}
                    {new Date(log.created_at).toLocaleString('ru-RU')}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-bold tabular-nums ${
                    change < 0 ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-success)]'
                  }`}
                >
                  {change > 0 ? `+${change}` : change}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
