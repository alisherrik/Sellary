import { useEffect, useState } from 'react';
import { XMarkIcon, PrinterIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { getSaleWithItems } from '../../lib/db';
import type { SaleWithItems } from '../../lib/db';
import { requestSync } from '../../lib/sync-engine';
import { formatCurrency } from '../../lib/format';
import { SyncStatusBadge } from './SyncStatusBadge';
import { PaymentChip } from './PaymentChip';

export function SaleDetailPanel({ saleId, onClose }: { saleId: number | null; onClose: () => void }) {
  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (saleId == null) {
      setSale(null);
      return;
    }
    setSale(null);
    getSaleWithItems(saleId).then((row) => {
      if (!cancelled) setSale(row);
    });
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  if (saleId == null) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await requestSync('manual', { force: true });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
        <div>
          <h2 className="font-mono text-[17px] font-bold text-gray-900 dark:text-white">Чек #{sale?.receipt_no ?? ''}</h2>
          <p className="text-[12px] text-gray-400">
            {sale ? new Date(sale.created_at_client).toLocaleString('ru-RU') : ''}
            {sale?.cashier_username ? ` · ${sale.cashier_username}` : ''}
          </p>
        </div>
        {sale && <span className="ml-auto"><SyncStatusBadge syncStatus={sale.sync_status} errorKind={sale.error_kind} /></span>}
        <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      {!sale ? (
        <div className="p-8 text-center text-sm text-gray-400">Загрузка…</div>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Items from the structured snapshot */}
          <div>
            <p className="mb-2 text-[13px] font-semibold text-gray-900 dark:text-white">Товары · {sale.items.length}</p>
            <div className="space-y-2">
              {sale.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-gray-800 dark:text-gray-100">{item.product_name}</p>
                    <p className="text-[11px] text-gray-400">
                      {item.quantity} {item.uom} × {formatCurrency(item.unit_price)}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(item.line_total)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700">
            <div className="flex justify-between text-[13px] text-gray-500"><span>Подытог</span><span className="tabular-nums">{formatCurrency(sale.subtotal)}</span></div>
            <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Скидка</span><span className="tabular-nums">{formatCurrency(sale.discount_amount)}</span></div>
            <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Налог</span><span className="tabular-nums">{formatCurrency(sale.tax_amount)}</span></div>
            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-[13px] font-semibold text-gray-900 dark:border-gray-700 dark:text-white"><span>Итого</span><span className="tabular-nums">{formatCurrency(sale.total_amount)}</span></div>
            <div className="mt-2 flex items-center justify-between text-[13px] text-gray-500"><span>Оплата</span><PaymentChip method={sale.payment_method} cardType={sale.card_type} /></div>
            {sale.payment_method === 'cash' && (
              <>
                <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Получено</span><span className="tabular-nums">{formatCurrency(sale.paid_amount)}</span></div>
                <div className="mt-1 flex justify-between text-[13px] text-gray-500"><span>Сдача</span><span className="tabular-nums">{formatCurrency(sale.change_amount)}</span></div>
              </>
            )}
          </div>

          {/* Sync-state box */}
          {sale.sync_status === 'synced' ? (
            <div className="rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              Синхронизировано{sale.server_sale_id != null ? ` · сервер #${sale.server_sale_id}` : ''}
              {sale.synced_at ? ` · ${new Date(sale.synced_at).toLocaleString('ru-RU')}` : ''}
            </div>
          ) : sale.sync_status === 'failed' && sale.error_kind === 'permanent' ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20">
              <p className="text-[13px] font-semibold text-red-700 dark:text-red-300">Ошибка синхронизации</p>
              {sale.last_error && <p className="mt-1 text-[12px] text-red-700/90 dark:text-red-300/90">{sale.last_error}</p>}
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Повторить
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Ожидает синхронизации
            </div>
          )}

          <p className="text-[12px] italic text-gray-400">Возвраты и долги доступны в веб-версии (нужен интернет).</p>
        </div>
      )}

      {sale && (
        <div className="mt-auto border-t border-gray-100 p-4 dark:border-gray-700">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <PrinterIcon className="h-4 w-4" />
            Печать чека
          </button>
        </div>
      )}
    </div>
  );
}
