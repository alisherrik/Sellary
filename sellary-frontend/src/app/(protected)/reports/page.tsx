'use client';

import dynamic from 'next/dynamic';
import OfflineGuard from '@/components/OfflineGuard';
import { CardSkeleton, ChartSkeleton, StatCardsSkeleton } from '@/components/skeletons';
import { useDailySales, useDashboard, useTopProducts } from '@/hooks/useQueries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import {
  ArrowTrendingUpIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';

const SalesChart = dynamic(() => import('@/components/reports/SalesChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const dayOptions = [7, 30, 90];

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const { data: dashboard, isLoading: dashboardLoading } = useDashboard();
  const { data: salesData, isLoading: salesLoading } = useDailySales(days);
  const { data: topProducts, isLoading: topProductsLoading } = useTopProducts(days, 5);

  const stats = salesData
    ? [
        {
          name: 'Выручка',
          value: formatCurrency(salesData.total_sales),
          icon: ChartBarIcon,
          color: 'bg-blue-500',
        },
        {
          name: 'Прибыль',
          value: formatCurrency(salesData.total_profit),
          icon: ArrowTrendingUpIcon,
          color: 'bg-green-500',
        },
        {
          name: 'Чеки',
          value: formatNumber(salesData.sales_count),
          icon: ShoppingBagIcon,
          color: 'bg-slate-900',
        },
        {
          name: 'Заканчиваются',
          value: formatNumber(dashboard?.low_stock_count || 0),
          icon: ExclamationTriangleIcon,
          color: 'bg-amber-500',
        },
      ]
    : [];

  return (
    <OfflineGuard>
      <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {dayOptions.map((option) => (
            <button
              key={option}
              onClick={() => setDays(option)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                option === days
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {option} дн.
            </button>
          ))}
        </div>

        {salesLoading || dashboardLoading ? (
          <StatCardsSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.name}
                className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-4"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className={`${stat.color} rounded-lg p-2 text-white sm:p-3`}>
                    <stat.icon className="h-4 w-4 sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-medium text-gray-500 dark:text-gray-400 sm:text-sm">
                      {stat.name}
                    </p>
                    <p className="truncate text-sm font-bold text-gray-900 dark:text-white sm:text-2xl">
                      {stat.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr,1fr] sm:gap-6">
              {salesLoading ? (
                <div className="space-y-4">
                  <CardSkeleton />
                  <ChartSkeleton />
                </div>
              ) : (
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
                  <div className="mb-4">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white sm:text-lg">
                      Динамика продаж
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                      Общая выручка за последние {days} дней
                    </p>
                  </div>

                  <SalesChart data={salesData?.data ?? []} days={days} />
                </div>
              )}

          <div className="space-y-4 sm:space-y-6">
            {topProductsLoading ? (
              <CardSkeleton />
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700 sm:px-5 sm:py-4">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white sm:text-lg">
                    Топ товаров
                  </h2>
                </div>
                <div className="p-4 sm:p-5">
                  {!topProducts || topProducts.top_products.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      Нет данных по товарам
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {topProducts.top_products.map((product, index) => (
                        <div key={product.product_id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-gray-400">#{index + 1}</div>
                            <div className="truncate font-medium text-gray-900 dark:text-white">
                              {product.product_name}
                            </div>
                            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {product.barcode || 'Без штрихкода'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">
                              {product.quantity_sold} шт
                            </div>
                            <div className="text-xs text-green-600">
                              {formatCurrency(product.total_profit || 0)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {dashboardLoading ? (
              <CardSkeleton />
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700 sm:px-5 sm:py-4">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white sm:text-lg">
                    Остатки
                  </h2>
                </div>
                <div className="p-4 sm:p-5">
                  {!dashboard || dashboard.low_stock_items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      Критичных остатков нет
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {dashboard.low_stock_items.slice(0, 5).map((item: any) => (
                        <div key={item.product_id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-gray-900 dark:text-white">
                              {item.product_name}
                            </div>
                            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {item.barcode || 'Без штрихкода'}
                            </div>
                          </div>
                          <div className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                            {item.current_stock} шт
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </OfflineGuard>
  );
}
