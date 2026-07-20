import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ShopOrder } from '../types';
import { getMyOrders } from '../lib/api';
import { formatPrice } from '../lib/format';
import { statusLabel, statusBadge } from '../lib/orderStatus';

/** Format an ISO timestamp as "20.07.2026 14:30" (local time). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function OrdersPage() {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getMyOrders()
      .then((page) => { setOrders(page.items); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-blue-600 text-white px-4 py-3 flex items-center gap-3 shadow">
        <Link to="/" className="text-white">← Каталог</Link>
        <h1 className="font-bold text-lg">Мои заказы</h1>
      </header>

      <main className="flex-1 p-3">
        {loading && <p className="text-center text-gray-500 py-8">Загрузка…</p>}
        {error && <p className="text-center text-red-500 py-8">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-gray-500">У вас пока нет заказов</p>
            <Link to="/" className="px-6 py-2 bg-blue-600 text-white rounded-xl">
              Перейти в каталог
            </Link>
          </div>
        )}
        <div className="space-y-2">
          {orders.map((o) => (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="block bg-white rounded-xl border border-gray-100 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-bold text-gray-900">№{o.order_number}</span>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(o.created_at)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(o.status)}`}>
                  {statusLabel(o.status)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-gray-500">{o.items.length} поз.</span>
                <span className="font-semibold text-blue-600">{formatPrice(o.total_amount)}</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
