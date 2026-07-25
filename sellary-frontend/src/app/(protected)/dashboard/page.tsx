'use client';

import { useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ShoppingCartIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';
import { StatCardsSkeleton, CardSkeleton } from '@/components/skeletons';
import { ModuleGuard } from '@/components/ModuleGuard';
import { useDashboard } from '@/hooks/useQueries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import Link from 'next/link';

function Dashboard() {
  const { data, isLoading, error } = useDashboard();

  useEffect(() => {
    if (error) {
      toast.error('Не удалось загрузить данные дашборда');
    }
  }, [error]);

  const stats = data
    ? [
        {
          name: 'Продажи',
          value: formatCurrency(data.today_sales),
          icon: CurrencyDollarIcon,
          color: 'bg-green-500',
        },
        {
          name: 'Прибыль',
          value: formatCurrency(data.today_profit),
          icon: ArrowTrendingUpIcon,
          color: 'bg-blue-500',
        },
        {
          name: 'Чеки',
          value: formatNumber(data.today_sales_count),
          icon: ShoppingCartIcon,
          color: 'bg-purple-500',
        },
        {
          name: 'Мало',
          value: formatNumber(data.low_stock_count),
          icon: ExclamationTriangleIcon,
          color: 'bg-yellow-500',
        },
      ]
    : [];

  return (
      <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
        <div>
          <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Дашборд</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">Сегодня</p>
        </div>

        {isLoading ? (
          <StatCardsSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.name}
                className="border-2 border-[var(--erp-divider)] bg-white p-3 sm:p-4"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className={`${stat.color} p-2 sm:p-3`}>
                    <stat.icon className="h-4 w-4 text-white sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--erp-muted)] sm:text-[11px]">
                      {stat.name}
                    </p>
                    <p className="truncate text-sm font-extrabold text-[var(--erp-text)] sm:text-2xl">
                      {stat.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
          {isLoading ? (
            <CardSkeleton />
          ) : (
            <div className="overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
              <div className="border-b border-[var(--erp-divider)] px-4 py-3 sm:px-5 sm:py-4">
                <h3 className="text-sm font-bold text-[var(--erp-text)] sm:text-lg">
                  Топ продаж
                </h3>
              </div>
              <div className="p-3 sm:p-5">
                {!data || data.top_products.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">Данных пока нет</p>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {data.top_products.slice(0, 5).map((product: any, index: number) => (
                      <div key={product.product_id} className="flex items-center justify-between">
                        <div className="flex min-w-0 flex-1 items-center">
                          <span className="mr-2 text-sm text-[var(--erp-muted)] sm:mr-3 sm:text-base">#{index + 1}</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[var(--erp-text)] sm:text-base">
                              {product.product_name}
                            </p>
                            <p className="truncate text-[10px] text-gray-500 sm:text-sm">{product.barcode}</p>
                          </div>
                        </div>
                        <div className="ml-2 flex-shrink-0 text-right">
                          <p className="text-xs font-medium text-[var(--erp-text)] sm:text-base">
                            {product.quantity_sold} шт
                          </p>
                          <p className="text-[10px] text-gray-500 sm:text-sm">
                            {formatCurrency(product.revenue)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <CardSkeleton />
          ) : data && data.low_stock_items.length > 0 ? (
            <div className="overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
              <div className="border-b border-[var(--erp-divider)] px-4 py-3 sm:px-5 sm:py-4">
                <h3 className="text-sm font-bold text-[var(--erp-text)] sm:text-lg">
                  Заканчиваются
                </h3>
              </div>
              <div className="p-3 sm:p-5">
                <div className="space-y-3 sm:space-y-4">
                  {data.low_stock_items.slice(0, 5).map((item: any) => (
                    <div key={item.product_id} className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--erp-text)] sm:text-base">
                          {item.product_name}
                        </p>
                        <p className="truncate text-[10px] text-gray-500 sm:text-sm">{item.barcode}</p>
                      </div>
                      <div className="ml-2 flex-shrink-0">
                        <span className="bg-[var(--erp-badge-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--erp-badge-text)] sm:py-1 sm:text-xs">
                          {item.current_stock} ост.
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-[var(--erp-divider)] pt-3">
                  {/* The dashboard's job is to start this order, not just to
                      name the problem and stop. */}
                  <Link
                    href="/purchase-orders/new?from=low-stock"
                    className="inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
                  >
                    Создать закупку по этому списку
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <CardSkeleton />
        ) : (
          <div className="overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
            <div className="border-b border-[var(--erp-divider)] px-4 py-3 sm:px-5 sm:py-4">
              <h3 className="text-sm font-bold text-[var(--erp-text)] sm:text-lg">
                Последние продажи
              </h3>
            </div>
            <div className="p-3 sm:p-5">
              {!data || data.recent_sales.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-500">Продаж пока нет</p>
              ) : (
                <>
                  <div className="space-y-2 sm:hidden">
                    {data.recent_sales.map((sale: any) => (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-[var(--erp-text)]">#{sale.id}</p>
                          <p className="text-[10px] text-gray-500">
                            {new Date(sale.created_at).toLocaleString('ru-RU')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-[var(--erp-text)]">
                            {formatCurrency(sale.total_amount)}
                          </p>
                          <p className="text-[10px] uppercase text-gray-500">{sale.payment_method}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                          <th className="pb-3 font-medium">Чек №</th>
                          <th className="pb-3 font-medium">Дата и время</th>
                          <th className="pb-3 font-medium">Сумма</th>
                          <th className="pb-3 font-medium">Оплата</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--erp-divider)]">
                        {data.recent_sales.map((sale: any) => (
                          <tr key={sale.id}>
                            <td className="py-3 font-medium text-[var(--erp-text)]">#{sale.id}</td>
                            <td className="py-3 text-gray-600">
                              {new Date(sale.created_at).toLocaleString('ru-RU')}
                            </td>
                            <td className="py-3 font-medium text-[var(--erp-text)]">
                              {formatCurrency(sale.total_amount)}
                            </td>
                            <td className="py-3 uppercase text-gray-600">
                              {sale.payment_method}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
  );
}

export default function DashboardPage() {
  return (
    <ModuleGuard module="reports">
      <Dashboard />
    </ModuleGuard>
  );
}
