'use client';

import { useDashboard } from '@/hooks/useQueries';
import OfflineGuard from '@/components/OfflineGuard';
import { formatCurrency, formatNumber } from '@/lib/utils';
import {
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ShoppingCartIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';

import { StatCardsSkeleton, CardSkeleton } from '@/components/skeletons';
import toast from 'react-hot-toast';
import { useEffect } from 'react';

export default function Dashboard() {
  const { data, isLoading, error } = useDashboard();

  useEffect(() => {
    if (error) {
      toast.error('Не удалось загрузить данные дашборда');
    }
  }, [error]);

  const stats = data ? [
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
  ] : [];

  return (
    <OfflineGuard>
      <div className="space-y-4 sm:space-y-6 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Дашборд</h1>
          <p className="text-xs sm:text-base text-gray-600 dark:text-gray-400">Добро пожаловать! Вот что происходит сегодня.</p>
        </div>

        {/* Stats cards - 2x2 on mobile */}
        {isLoading ? (
          <StatCardsSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {stats.map((stat) => (
              <div key={stat.name} className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className={`${stat.color} p-2 sm:p-3 rounded-lg flex-shrink-0`}>
                    <stat.icon className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-sm font-medium text-gray-600 dark:text-gray-400 truncate">
                      {stat.name}
                    </p>
                    <p className="text-sm sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
                      {stat.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Top Products */}
          {isLoading ? (
            <CardSkeleton />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white">
                  Топ продаж
                </h3>
              </div>
              <div className="p-3 sm:p-5">
                {!data || data.top_products.length === 0 ? (
                  <p className="text-gray-500 text-center py-4 text-sm">Данных пока нет</p>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {data.top_products.slice(0, 5).map((product: any, index: number) => (
                      <div key={product.product_id} className="flex items-center justify-between">
                        <div className="flex items-center min-w-0 flex-1">
                          <span className="text-gray-400 mr-2 sm:mr-3 text-sm sm:text-base">#{index + 1}</span>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-white text-xs sm:text-base truncate">
                              {product.product_name}
                            </p>
                            <p className="text-[10px] sm:text-sm text-gray-500 truncate">{product.barcode}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <p className="font-medium text-gray-900 dark:text-white text-xs sm:text-base">
                            {product.quantity_sold} шт
                          </p>
                          <p className="text-[10px] sm:text-sm text-gray-500">
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

          {/* Low Stock Alerts */}
          {isLoading ? (
            <CardSkeleton />
          ) : data && data.low_stock_items.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white">
                  Заканчивается
                </h3>
              </div>
              <div className="p-3 sm:p-5">
                <div className="space-y-3 sm:space-y-4">
                  {data.low_stock_items.slice(0, 5).map((item: any) => (
                    <div key={item.product_id} className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-white text-xs sm:text-base truncate">
                          {item.product_name}
                        </p>
                        <p className="text-[10px] sm:text-sm text-gray-500 truncate">{item.barcode}</p>
                      </div>
                      <div className="flex items-center flex-shrink-0 ml-2">
                        <span className="px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-red-100 text-red-800 rounded">
                          {item.current_stock} ост.
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recent Sales */}
        {isLoading ? (
          <CardSkeleton />
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white">Недавние продажи</h3>
            </div>
            <div className="p-3 sm:p-5">
              {!data || data.recent_sales.length === 0 ? (
                <p className="text-gray-500 text-center py-4 text-sm">Продаж пока нет</p>
              ) : (
                <>
                  {/* Mobile cards view */}
                  <div className="sm:hidden space-y-2">
                    {data.recent_sales.map((sale: any) => (
                      <div key={sale.id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white text-sm">#{sale.id}</p>
                          <p className="text-[10px] text-gray-500">{new Date(sale.created_at).toLocaleString('ru-RU')}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-gray-900 dark:text-white text-sm">{formatCurrency(sale.total_amount)}</p>
                          <p className="text-[10px] text-gray-500 uppercase">{sale.payment_method}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop table view */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-600">
                          <th className="pb-3 font-medium">Чек №</th>
                          <th className="pb-3 font-medium">Дата и время</th>
                          <th className="pb-3 font-medium">Сумма</th>
                          <th className="pb-3 font-medium">Оплата</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {data.recent_sales.map((sale: any) => (
                          <tr key={sale.id}>
                            <td className="py-3 font-medium text-gray-900 dark:text-white">#{sale.id}</td>
                            <td className="py-3 text-gray-600 dark:text-gray-400">{new Date(sale.created_at).toLocaleString('ru-RU')}</td>
                            <td className="py-3 font-medium text-gray-900 dark:text-white">{formatCurrency(sale.total_amount)}</td>
                            <td className="py-3 uppercase text-gray-600 dark:text-gray-400">{sale.payment_method}</td>
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
    </OfflineGuard>
  );
}
