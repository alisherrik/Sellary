import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ShopOrder } from '../types';
import { getMyOrder } from '../lib/api';
import { formatPrice } from '../lib/format';
import { statusLabel, statusBadge } from '../lib/orderStatus';

const FULFILLMENT_LABELS: Record<string, string> = {
  pickup: 'Самовывоз',
  delivery: 'Доставка',
};

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);

  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setError('Неверный номер заказа');
      setLoading(false);
      return;
    }
    setLoading(true);
    getMyOrder(orderId)
      .then((o) => { setOrder(o); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [orderId]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-blue-600 text-white px-4 py-3 flex items-center gap-3 shadow">
        <Link to="/orders" className="text-white">← Заказы</Link>
        <h1 className="font-bold text-lg">
          {order ? `Заказ №${order.order_number}` : 'Заказ'}
        </h1>
      </header>

      <main className="flex-1 p-3">
        {loading && <p className="text-center text-gray-500 py-8">Загрузка…</p>}
        {error && <p className="text-center text-red-500 py-8">{error}</p>}

        {order && (
          <div className="space-y-3">
            {/* Status */}
            <div className="bg-white rounded-xl p-4 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusBadge(order.status)}`}>
                {statusLabel(order.status)}
              </span>
              <span className="text-sm text-gray-500">
                {FULFILLMENT_LABELS[order.fulfillment_type] ?? order.fulfillment_type}
              </span>
            </div>

            {/* Contact / delivery */}
            <div className="bg-white rounded-xl p-4">
              <h2 className="font-semibold text-gray-800 mb-2">Получатель</h2>
              <p className="text-sm text-gray-900">{order.contact_name}</p>
              <p className="text-sm text-gray-600">{order.contact_phone}</p>
              {order.fulfillment_type === 'delivery' && order.delivery_address && (
                <p className="text-sm text-gray-600 mt-1">{order.delivery_address}</p>
              )}
              {order.notes && (
                <p className="text-xs italic text-gray-500 mt-1">{order.notes}</p>
              )}
            </div>

            {/* Items */}
            <div className="bg-white rounded-xl p-4">
              <h2 className="font-semibold text-gray-800 mb-2">Состав заказа</h2>
              <ul className="divide-y divide-gray-100">
                {order.items.map((it) => (
                  <li key={it.id} className="py-2 flex items-start justify-between gap-2 text-sm">
                    <div>
                      <p className="text-gray-900">{it.product_name}</p>
                      <p className="text-xs text-gray-400">
                        {it.quantity} × {formatPrice(it.unit_price)}
                      </p>
                    </div>
                    <span className="font-medium text-gray-900">{formatPrice(it.line_total)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between text-base font-bold">
                <span>Итого:</span>
                <span className="text-blue-600">{formatPrice(order.total_amount)}</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
