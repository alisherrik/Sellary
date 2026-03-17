'use client';

import { useRouter } from 'next/navigation';
import { useRestaurantStore, TableStatus } from '@/lib/restaurant-store';
import { useState, useEffect } from 'react';
import { formatCurrency } from '@/lib/utils';

const getStatusColor = (status: TableStatus) => {
  switch (status) {
    case 'empty':
      return 'border-green-500 bg-white hover:bg-green-50';
    case 'ordering':
      return 'border-blue-500 bg-blue-50';
    case 'waiting':
      return 'border-yellow-500 bg-yellow-50';
    case 'served':
      return 'border-purple-500 bg-purple-50';
    case 'paying':
      return 'border-orange-500 bg-orange-50';
    default:
      return 'border-gray-300 bg-gray-50';
  }
};

const getStatusBadge = (status: TableStatus) => {
  switch (status) {
    case 'empty':
      return { text: 'Свободен', color: 'bg-green-100 text-green-700' };
    case 'ordering':
      return { text: 'Заказ', color: 'bg-blue-100 text-blue-700' };
    case 'waiting':
      return { text: 'Ожидает', color: 'bg-yellow-100 text-yellow-700' };
    case 'served':
      return { text: 'Обслужен', color: 'bg-purple-100 text-purple-700' };
    case 'paying':
      return { text: 'Оплата', color: 'bg-orange-100 text-orange-700' };
    default:
      return { text: status, color: 'bg-gray-100 text-gray-700' };
  }
};

const getStatusIcon = (status: TableStatus) => {
  switch (status) {
    case 'empty':
      return (
        <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      );
    case 'ordering':
      return (
        <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      );
    case 'waiting':
      return (
        <svg className="w-6 h-6 sm:w-8 sm:h-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'served':
      return (
        <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'paying':
      return (
        <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      );
    default:
      return null;
  }
};

export default function RestaurantPage() {
  const router = useRouter();
  const {
    tables,
    activeOrders,
    selectTable,
    getActiveOrdersCount,
    getOccupiedTablesCount,
    getTotalPendingAmount,
  } = useRestaurantStore();

  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | TableStatus>('all');

  useEffect(() => {
    setTimeout(() => setIsLoading(false), 300);
  }, []);

  const handleTableClick = (tableName: string, status: TableStatus) => {
    selectTable(tableName);

    if (status === 'empty') {
      router.push('/restaurant/order');
    } else if (status === 'paying') {
      router.push(`/restaurant/payment/${encodeURIComponent(tableName)}`);
    } else {
      router.push(`/restaurant/table/${encodeURIComponent(tableName)}`);
    }
  };

  const filteredTables = filter === 'all'
    ? tables
    : tables.filter(t => t.status === filter);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="pb-20 sm:pb-24">
      {/* Stats Cards - 2x2 grid on mobile */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold text-gray-900">{getActiveOrdersCount()}</p>
              <p className="text-[10px] sm:text-xs text-gray-500 truncate">Активные заказы</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold text-gray-900">{getOccupiedTablesCount()}</p>
              <p className="text-[10px] sm:text-xs text-gray-500 truncate">Занято столов</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold text-gray-900">{formatCurrency(getTotalPendingAmount())}</p>
              <p className="text-[10px] sm:text-xs text-gray-500 truncate">Ожидается</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold text-gray-900">{tables.length}</p>
              <p className="text-[10px] sm:text-xs text-gray-500 truncate">Всего столов</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header with filters */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900">Столы</h1>
            <p className="text-xs sm:text-sm text-gray-600">Выберите стол для заказа</p>
          </div>
        </div>

        {/* Filter buttons - horizontal scroll on mobile */}
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilter('empty')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${filter === 'empty' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
          >
            Свободно
          </button>
          <button
            onClick={() => setFilter('waiting')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${filter === 'waiting' ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
              }`}
          >
            Ожидает
          </button>
          <button
            onClick={() => setFilter('served')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${filter === 'served' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              }`}
          >
            Обслужен
          </button>
          <button
            onClick={() => setFilter('paying')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${filter === 'paying' ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
              }`}
          >
            Оплата
          </button>
        </div>
      </div>

      {/* Table Grid - 3 columns on mobile, more on larger screens */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-4">
        {filteredTables.map((table) => {
          const order = activeOrders[table.name];
          const statusBadge = getStatusBadge(table.status);

          return (
            <button
              key={table.name}
              onClick={() => handleTableClick(table.name, table.status)}
              className={`
                aspect-square rounded-xl flex flex-col items-center justify-center p-2 sm:p-4
                transition-all duration-200 active:scale-95 border-2
                ${getStatusColor(table.status)}
                shadow-sm hover:shadow-md
              `}
            >
              {/* Status Icon */}
              <div className={`
                w-10 h-10 sm:w-14 sm:h-14 rounded-full flex items-center justify-center mb-1 sm:mb-2
                ${table.status === 'empty' ? 'bg-green-100 text-green-600' :
                  table.status === 'waiting' ? 'bg-yellow-100 text-yellow-600' :
                    table.status === 'served' ? 'bg-purple-100 text-purple-600' :
                      table.status === 'paying' ? 'bg-orange-100 text-orange-600' :
                        'bg-blue-100 text-blue-600'}
              `}>
                {getStatusIcon(table.status)}
              </div>

              {/* Table Name */}
              <span className="font-semibold text-gray-900 text-xs sm:text-base leading-tight text-center">
                {table.name}
              </span>

              {/* Status Badge - smaller on mobile */}
              <span className={`text-[9px] sm:text-xs mt-0.5 sm:mt-1 px-1.5 sm:px-3 py-0.5 sm:py-1 rounded-full font-medium ${statusBadge.color}`}>
                {statusBadge.text}
              </span>

              {/* Order Amount (if exists) */}
              {order && (
                <span className="mt-1 text-[10px] sm:text-sm font-bold text-gray-700">
                  {formatCurrency(order.totalAmount)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filteredTables.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">Столы с таким статусом не найдены</p>
        </div>
      )}

      {/* Bottom Quick Actions Bar */}
      <div className="fixed bottom-0 right-0 left-0 md:left-64 bg-white border-t border-gray-200 p-2 sm:p-4 z-40 safe-area-bottom">
        <div className="max-w-4xl mx-auto flex gap-2 sm:gap-3">
          <button
            onClick={() => router.push('/restaurant/orders')}
            className="flex-1 h-10 sm:h-12 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-1 sm:gap-2 text-sm sm:text-base"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="hidden xs:inline">Заказы</span>
          </button>
          <button
            onClick={() => router.push('/pos')}
            className="flex-1 h-10 sm:h-12 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-1 sm:gap-2 text-sm sm:text-base"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="hidden xs:inline">Касса</span>
          </button>
        </div>
      </div>
    </div>
  );
}
