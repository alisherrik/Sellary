import type { LocalSale } from '../../lib/db';
import { formatCurrency } from '../../lib/format';
import { SyncStatusBadge } from './SyncStatusBadge';
import { PaymentChip } from './PaymentChip';

export function SalesTable({
  sales,
  selectedId,
  onRowClick,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  sales: LocalSale[];
  selectedId: number | null;
  onRowClick: (sale: LocalSale) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (sales.length === 0) {
    return <div className="p-12 text-center text-gray-500">Продажи не найдены</div>;
  }
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-400 dark:border-gray-700">
            <th className="px-4 py-3 text-left font-medium">Чек</th>
            <th className="px-4 py-3 text-left font-medium">Время</th>
            <th className="px-4 py-3 text-left font-medium">Оплата</th>
            <th className="px-4 py-3 text-right font-medium">Сумма</th>
            <th className="px-4 py-3 text-left font-medium">Синхронизация</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => {
            const active = selectedId === sale.id;
            return (
              <tr
                key={sale.id}
                onClick={() => onRowClick(sale)}
                className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 dark:border-gray-700/50 dark:hover:bg-gray-700/40 ${
                  active ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''
                }`}
              >
                <td className="px-4 py-3 font-mono font-semibold text-gray-900 dark:text-white">
                  #{sale.receipt_no}
                  <span className="ml-2 text-[10px] font-normal text-gray-400">{sale.client_sale_id.slice(0, 8)}</span>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-gray-400">
                  {new Date(sale.created_at_client).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 py-3">
                  <PaymentChip method={sale.payment_method} cardType={sale.card_type} />
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(sale.total_amount)}
                </td>
                <td className="px-4 py-3">
                  <SyncStatusBadge syncStatus={sale.sync_status} errorKind={sale.error_kind} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="flex justify-center border-t border-gray-50 p-4 dark:border-gray-700/50">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {loadingMore ? 'Загрузка…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </div>
  );
}
