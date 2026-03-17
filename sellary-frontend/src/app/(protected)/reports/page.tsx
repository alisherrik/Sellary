'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import OfflineGuard from '@/components/OfflineGuard';
import { formatCurrency, formatNumber } from '@/lib/utils';
import {
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

import { ChartSkeleton, CardSkeleton } from '@/components/skeletons';
import { useDailySales, useProfit, useTopProducts } from '@/hooks/useQueries';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

type ReportTab = 'sales' | 'profit' | 'products';

export default function Reports() {
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [days, setDays] = useState(30);

  const salesQuery = useDailySales(days, { enabled: activeTab === 'sales' });
  const profitQuery = useProfit(days, { enabled: activeTab === 'profit' });
  const productsQuery = useTopProducts(days, 10, { enabled: activeTab === 'products' });

  const renderSalesReport = () => {
    const { data: salesData, isLoading } = salesQuery;
    if (isLoading && !salesData) return <div className="space-y-4"><CardSkeleton /><ChartSkeleton /></div>;
    if (!salesData) return null;

    return (
      <div className="space-y-4">
        {/* Stats - 3 columns on mobile */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="bg-blue-500 p-1.5 sm:p-3 rounded-lg flex-shrink-0">
                <ChartBarIcon className="w-3 h-3 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400 truncate">Выручка</p>
                <p className="text-xs sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
                  {formatCurrency(salesData.total_sales)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="bg-green-500 p-1.5 sm:p-3 rounded-lg flex-shrink-0">
                <ArrowTrendingUpIcon className="w-3 h-3 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400 truncate">Прибыль</p>
                <p className="text-xs sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
                  {formatCurrency(salesData.total_profit)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="bg-purple-500 p-1.5 sm:p-3 rounded-lg flex-shrink-0">
                <ShoppingBagIcon className="w-3 h-3 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400 truncate">Чеки</p>
                <p className="text-xs sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
                  {formatNumber(salesData.sales_count)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {salesData.data && salesData.data.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">
              Динамика продаж
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={salesData.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => formatCurrency(value as number)} />
                <Line type="monotone" dataKey="total_sales" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  };

  const renderProfitReport = () => {
    const { data: profitData, isLoading } = profitQuery;
    if (isLoading && !profitData) return <div className="space-y-4"><CardSkeleton /><ChartSkeleton /></div>;
    if (!profitData) return null;

    const marginPercent = parseFloat(profitData.profit_margin_percent || '0');

    return (
      <div className="space-y-4">
        {/* Stats - 2x2 on mobile */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400">Выручка</p>
            <p className="text-sm sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
              {formatCurrency(profitData.revenue || 0)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400">Себестоимость</p>
            <p className="text-sm sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
              {formatCurrency(profitData.cost || 0)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400">Прибыль</p>
            <p className="text-sm sm:text-2xl font-bold text-green-600 truncate">
              {formatCurrency(profitData.profit || 0)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <p className="text-[10px] sm:text-sm text-gray-600 dark:text-gray-400">Маржа</p>
            <p className="text-sm sm:text-2xl font-bold text-blue-600">{marginPercent.toFixed(1)}%</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={[
                { name: 'Выручка', value: parseFloat(profitData.revenue || '0') },
                { name: 'Себестоим.', value: parseFloat(profitData.cost || '0') },
                { name: 'Прибыль', value: parseFloat(profitData.profit || '0') },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(value) => formatCurrency(value as number)} />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderProductsReport = () => {
    const { data: topProducts, isLoading } = productsQuery;
    if (isLoading && !topProducts) return <div className="space-y-4"><CardSkeleton /><ChartSkeleton /></div>;
    if (!topProducts) return null;

    const productsList = topProducts.top_products || [];

    return (
      <div className="space-y-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-3 sm:px-5 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white">
              Топ товаров ({days} дн.)
            </h3>
          </div>
          <div className="p-3 sm:p-5">
            {productsList.length === 0 ? (
              <p className="text-center text-gray-500 py-8 text-sm">Нет данных</p>
            ) : (
              <div className="space-y-2 sm:space-y-4">
                {productsList.map((product: any, index: number) => (
                  <div key={product.product_id} className="flex items-center justify-between border-b dark:border-gray-700 pb-2 sm:pb-4 last:border-0">
                    <div className="flex items-center min-w-0 flex-1">
                      <span className="text-lg sm:text-2xl font-bold text-gray-400 mr-2 sm:mr-4">#{index + 1}</span>
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
                      <p className="text-[10px] sm:text-sm text-green-600">
                        {formatCurrency(product.profit || product.total_profit || 0)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {productsList.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={productsList.slice(0, 5)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="product_name" tick={{ fontSize: 8 }} interval={0} angle={-15} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="quantity_sold" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  };

  const isLoading = salesQuery.isLoading || profitQuery.isLoading || productsQuery.isLoading;

  const tabs = [
    { key: 'sales' as ReportTab, label: 'Продажи', shortLabel: 'Продажи' },
    { key: 'profit' as ReportTab, label: 'Прибыль', shortLabel: 'Прибыль' },
    { key: 'products' as ReportTab, label: 'Товары', shortLabel: 'Товары' },
  ];

  return (
    <OfflineGuard>

      <div className="space-y-4 sm:space-y-6 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Отчеты</h1>
          <p className="text-xs sm:text-base text-gray-600 dark:text-gray-400">Анализ эффективности</p>
        </div>

        {/* Tabs - scrollable on mobile */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-4 sm:gap-8 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-2 sm:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm transition-colors whitespace-nowrap ${activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-2 sm:gap-4">
          <label className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
            Период:
          </label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="h-8 sm:h-10 px-2 sm:px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs sm:text-sm"
          >
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
            <option value={365}>Год</option>
          </select>
          {isLoading && (
            <div className="ml-2 animate-pulse">
              <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          )}
        </div>

        {/* Report Content */}
        {activeTab === 'sales' && renderSalesReport()}
        {activeTab === 'profit' && renderProfitReport()}
        {activeTab === 'products' && renderProductsReport()}
      </div>

    </OfflineGuard>
  );
}
