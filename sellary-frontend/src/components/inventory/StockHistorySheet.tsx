'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';

import { inventoryApi } from '@/lib/api';
import type { InventoryLog, Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface StockHistorySheetProps {
  product: Product;
  onClose: () => void;
}

const REFERENCE_LABELS: Record<string, string> = {
  sale: 'Продажа',
  sale_return: 'Возврат',
  purchase_order: 'Приёмка',
  adjustment: 'Корректировка',
  reversal: 'Аннулирование',
};

const formatQuantity = (value: number | string) => {
  const numeric = Number(value);
  const formatted = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(3);
  return numeric > 0 ? `+${formatted}` : formatted;
};

/**
 * Why is this number 3?
 *
 * Every adjustment, sale and receipt already writes an inventory log row with
 * who did it and what the quantity was before and after — and nothing in the
 * product read them back. A stock figure nobody can account for is a stock
 * figure nobody trusts, which is the whole promise of the inventory module.
 */
export default function StockHistorySheet({ product, onClose }: StockHistorySheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: logs = [], isLoading, isError, refetch } = useQuery<InventoryLog[]>({
    queryKey: ['inventoryLogs', product.id],
    queryFn: async () => {
      const response = await inventoryApi.getLogs({ product_id: product.id, limit: 100 });
      return response.data;
    },
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`История остатка: ${product.name}`}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[560px] flex-col border-l-2 border-[var(--erp-divider)] bg-white outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-[var(--erp-divider)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--erp-muted)]">
              Движение остатка
            </div>
            <h2 className="truncate text-[18px] font-extrabold tracking-tight text-[var(--erp-text)]">
              {product.name}
            </h2>
            <p className="text-[13px] text-[var(--erp-muted)]">
              Сейчас на складе: {product.stock_quantity} {product.uom}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="h-14 animate-pulse bg-[var(--erp-surface)]" />
              ))}
            </div>
          ) : isError ? (
            <div
              role="alert"
              className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-4 text-center"
            >
              <p className="text-[15px] font-extrabold text-[var(--erp-text)]">
                Не удалось загрузить историю
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-3 inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-[14px] font-extrabold text-white hover:bg-[var(--erp-accent-strong)]"
              >
                Повторить
              </button>
            </div>
          ) : logs.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--erp-muted)]">
              По этому товару ещё не было движений.
            </p>
          ) : (
            <ol className="space-y-2">
              {logs.map((log) => {
                const change = Number(log.quantity_change);
                return (
                  <li
                    key={log.id}
                    className="border border-[var(--erp-divider)] bg-white p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-bold text-[var(--erp-text)]">
                        {REFERENCE_LABELS[log.reference_type ?? ''] ?? 'Изменение'}
                      </span>
                      <span
                        className={`text-[17px] font-black tabular-nums ${
                          change < 0 ? 'text-[#dc2626]' : 'text-[var(--erp-success)]'
                        }`}
                      >
                        {formatQuantity(log.quantity_change)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-[var(--erp-muted)]">
                      <span className="tabular-nums">
                        {log.previous_quantity} → {log.new_quantity} {product.uom}
                      </span>
                      <span className="tabular-nums">
                        {new Date(log.created_at).toLocaleString('ru-RU')}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]">
                      <span className="text-[var(--erp-muted)]">{log.user_name}</span>
                      {Number(log.value_change) !== 0 && (
                        <span className="tabular-nums text-[var(--erp-muted)]">
                          {formatCurrency(log.value_change)}
                        </span>
                      )}
                    </div>
                    {log.reason && (
                      <p className="mt-1 text-[12px] text-[var(--erp-text)]">{log.reason}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
