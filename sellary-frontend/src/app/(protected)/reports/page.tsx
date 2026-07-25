'use client';

import dynamic from 'next/dynamic';
import { CardSkeleton, ChartSkeleton, StatCardsSkeleton } from '@/components/skeletons';
import { ModuleGuard } from '@/components/ModuleGuard';
import { useDailySales, useDashboard, useTopProducts } from '@/hooks/useQueries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import {
  ArrowTrendingUpIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import Link from 'next/link';

const SalesChart = dynamic(() => import('@/components/reports/SalesChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const dayOptions = [7, 30, 90];

function Reports() {
  const [days, setDays] = useState(30);
  const { data: dashboard, isLoading: dashboardLoading } = useDashboard();
  const { data: salesData, isLoading: salesLoading } = useDailySales(days);
  const { data: topProducts, isLoading: topProductsLoading } = useTopProducts(days, 5);

  const stats = salesData
    ? [
        {
          name: 'Выручка',
          value: formatCurrency(salesData.total_sales),
          // Net of refunds. The sales history headlines gross, so spell out the
          // difference here rather than leaving two screens quietly disagreeing.
          hint:
            Number(salesData.refunds ?? 0) > 0
              ? `оборот ${formatCurrency(salesData.gross_turnover)} − возвраты ${formatCurrency(salesData.refunds)}`
              : undefined,
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
      <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Аналитика</h2>
          <div className="ml-auto inline-flex border border-[var(--erp-divider)] bg-white p-1">
            {dayOptions.map((option) => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={`px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                  option === days
                    ? 'bg-[var(--erp-text)] text-white'
                    : 'text-gray-600 hover:text-[var(--erp-text)]'
                }`}
              >
                {option} дн.
              </button>
            ))}
          </div>
        </div>

        {salesLoading || dashboardLoading ? (
          <StatCardsSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.name}
                className="border-2 border-[var(--erp-divider)] bg-white p-3 sm:p-4"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className={`${stat.color} p-2 text-white sm:p-3`}>
                    <stat.icon className="h-4 w-4 sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--erp-muted)] sm:text-[11px]">
                      {stat.name}
                    </p>
                    <p className="truncate text-sm font-extrabold text-[var(--erp-text)] sm:text-2xl">
                      {stat.value}
                    </p>
                    {stat.hint && (
                      <p className="truncate text-[10px] text-[var(--erp-muted)]" title={stat.hint}>
                        {stat.hint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr] sm:gap-6">
              {salesLoading ? (
                <div className="space-y-4">
                  <CardSkeleton />
                  <ChartSkeleton />
                </div>
              ) : (
                <div className="border-2 border-[var(--erp-divider)] bg-white p-4 sm:p-5">
                  <div className="mb-4">
                    <h2 className="text-sm font-bold text-[var(--erp-text)] sm:text-lg">
                      Динамика продаж
                    </h2>
                    <p className="text-xs text-gray-500 sm:text-sm">
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
              <div className="overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
                <div className="border-b border-[var(--erp-divider)] px-4 py-3 sm:px-5 sm:py-4">
                  <h2 className="text-sm font-bold text-[var(--erp-text)] sm:text-lg">
                    Топ товаров
                  </h2>
                </div>
                <div className="p-4 sm:p-5">
                  {!topProducts || topProducts.top_products.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500">
                      Нет данных по товарам
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {topProducts.top_products.map((product, index) => (
                        <div key={product.product_id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-[var(--erp-muted)]">#{index + 1}</div>
                            <div className="truncate font-medium text-[var(--erp-text)]">
                              {product.product_name}
                            </div>
                            <div className="truncate text-xs text-gray-500">
                              {product.barcode || 'Без штрихкода'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-[var(--erp-text)]">
                              {product.quantity_sold} шт
                            </div>
                            <div className="text-xs text-green-600">
                              {formatCurrency(product.total_profit || 0)}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-[var(--erp-divider)] pt-3">
                        <Link
                          href="/purchase-orders/new?from=low-stock"
                          className="inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
                        >
                          Создать закупку
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {dashboardLoading ? (
              <CardSkeleton />
            ) : (
              <div className="overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
                <div className="border-b border-[var(--erp-divider)] px-4 py-3 sm:px-5 sm:py-4">
                  <h2 className="text-sm font-bold text-[var(--erp-text)] sm:text-lg">
                    Остатки
                  </h2>
                </div>
                <div className="p-4 sm:p-5">
                  {!dashboard || dashboard.low_stock_items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500">
                      Критичных остатков нет
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {dashboard.low_stock_items.slice(0, 5).map((item: any) => (
                        <div key={item.product_id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-[var(--erp-text)]">
                              {item.product_name}
                            </div>
                            <div className="truncate text-xs text-gray-500">
                              {item.barcode || 'Без штрихкода'}
                            </div>
                          </div>
                          <div className="bg-[var(--erp-badge-bg)] px-2 py-1 text-xs font-medium text-[var(--erp-badge-text)]">
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
  );
}

export default function ReportsPage() {
  return (
    <ModuleGuard module="reports">
      <Reports />
    </ModuleGuard>
  );
}
