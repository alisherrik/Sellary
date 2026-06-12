import {
  calculateOrderedQuantity,
  calculateOrderTotal,
  type PurchaseOrderFormData,
} from '@/features/purchase-orders/purchaseOrderForm';
import type { Supplier } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface PurchaseOrderSummaryProps {
  form: PurchaseOrderFormData;
  supplier?: Supplier;
}

export default function PurchaseOrderSummary({
  form,
  supplier,
}: PurchaseOrderSummaryProps) {
  return (
    <aside className="border-t border-gray-200 bg-white pt-5 lg:sticky lg:top-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Сводка закупки
      </p>
      <dl className="mt-4 space-y-4 text-sm">
        <div>
          <dt className="text-gray-500">Поставщик</dt>
          <dd className="mt-1 font-semibold text-gray-900">
            {supplier?.name ?? 'Не выбран'}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-gray-500">Позиций</dt>
            <dd className="mt-1 font-semibold tabular-nums text-gray-900">
              {form.items.filter((item) => Number(item.product_id)).length}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Количество</dt>
            <dd className="mt-1 font-semibold tabular-nums text-gray-900">
              {calculateOrderedQuantity(form.items)}
            </dd>
          </div>
        </div>
        <div>
          <dt className="text-gray-500">Ожидаемая дата</dt>
          <dd className="mt-1 font-semibold text-gray-900">
            {form.expected_delivery_date
              ? new Date(`${form.expected_delivery_date}T00:00:00`).toLocaleDateString('ru-RU')
              : 'Не указана'}
          </dd>
        </div>
        {form.notes.trim() && (
          <div>
            <dt className="text-gray-500">Примечание</dt>
            <dd className="mt-1 whitespace-pre-wrap text-gray-700">{form.notes}</dd>
          </div>
        )}
      </dl>
      <div className="mt-6 border-t border-gray-200 pt-5">
        <p className="text-sm font-medium text-gray-500">Итого</p>
        <p
          data-testid="purchase-order-total"
          className="mt-1 text-3xl font-black tabular-nums text-blue-600"
        >
          {formatCurrency(calculateOrderTotal(form.items))}
        </p>
      </div>
    </aside>
  );
}
