'use client';

import { useRouter } from 'next/navigation';
import { useRestaurantStore, TableStatus } from '@/lib/restaurant-store';
import { useState, useEffect } from 'react';

const getStatusBadge = (status: TableStatus) => {
    switch (status) {
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

export default function OrdersPage() {
    const router = useRouter();
    const { activeOrders, tables, getTotalPendingAmount } = useRestaurantStore();
    const [isLoading, setIsLoading] = useState(true);
    const [sortBy, setSortBy] = useState<'time' | 'amount'>('time');

    useEffect(() => {
        setTimeout(() => setIsLoading(false), 300);
    }, []);

    const orders = Object.entries(activeOrders).map(([tableName, order]) => {
        const table = tables.find(t => t.name === tableName);
        return {
            ...order,
            tableName,
            tableCapacity: table?.capacity || 0,
        };
    });

    const sortedOrders = [...orders].sort((a, b) => {
        if (sortBy === 'time') {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return b.totalAmount - a.totalAmount;
    });

    const handleOrderClick = (tableName: string, status: TableStatus) => {
        if (status === 'paying') {
            router.push(`/restaurant/payment/${encodeURIComponent(tableName)}`);
        } else {
            router.push(`/restaurant/table/${encodeURIComponent(tableName)}`);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="pb-20 sm:pb-24">
            {/* Header */}
            <header className="mb-4 sm:mb-6">
                <div className="flex items-center gap-3 sm:gap-4">
                    <button
                        onClick={() => router.push('/restaurant')}
                        className="p-1.5 sm:p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="flex-1">
                        <h1 className="text-lg sm:text-2xl font-bold text-gray-900">Активные заказы</h1>
                        <p className="text-xs sm:text-sm text-gray-600">{orders.length} заказов</p>
                    </div>
                </div>
            </header>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-4 sm:mb-6">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl sm:rounded-2xl p-3 sm:p-5 text-white">
                    <p className="text-blue-100 text-[10px] sm:text-sm mb-0.5 sm:mb-1">Активных заказов</p>
                    <p className="text-2xl sm:text-3xl font-bold">{orders.length}</p>
                </div>
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl sm:rounded-2xl p-3 sm:p-5 text-white">
                    <p className="text-green-100 text-[10px] sm:text-sm mb-0.5 sm:mb-1">Ожидается</p>
                    <p className="text-2xl sm:text-3xl font-bold">{(getTotalPendingAmount() / 1000).toFixed(0)}к</p>
                </div>
            </div>

            {/* Sort Options */}
            <div className="flex gap-2 mb-3 sm:mb-4">
                <button
                    onClick={() => setSortBy('time')}
                    className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${sortBy === 'time' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    По времени
                </button>
                <button
                    onClick={() => setSortBy('amount')}
                    className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${sortBy === 'amount' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    По сумме
                </button>
            </div>

            {/* Orders List */}
            {sortedOrders.length === 0 ? (
                <div className="text-center py-8 sm:py-12 bg-white rounded-2xl shadow-sm">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                        <svg className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">Нет активных заказов</h3>
                    <p className="text-xs sm:text-base text-gray-500 mb-4">Выберите стол для нового заказа</p>
                    <button
                        onClick={() => router.push('/restaurant')}
                        className="px-4 sm:px-6 py-2 sm:py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm sm:text-base"
                    >
                        К столам
                    </button>
                </div>
            ) : (
                <div className="space-y-3 sm:space-y-4">
                    {sortedOrders.map((order) => {
                        const statusBadge = getStatusBadge(order.status);
                        const pendingItems = order.items.filter(i => i.status !== 'served').length;
                        const servedItems = order.items.filter(i => i.status === 'served').length;

                        return (
                            <div
                                key={order.id}
                                onClick={() => handleOrderClick(order.tableName, order.status)}
                                className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-5 hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99]"
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between mb-2 sm:mb-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                            <h3 className="text-base sm:text-xl font-bold text-gray-900">{order.tableName}</h3>
                                            <span className={`text-[10px] sm:text-xs px-2 sm:px-3 py-0.5 sm:py-1 rounded-full font-medium ${statusBadge.color}`}>
                                                {statusBadge.text}
                                            </span>
                                        </div>
                                        <p className="text-[10px] sm:text-sm text-gray-500 mt-0.5 sm:mt-1 truncate">
                                            {order.guestCount && `${order.guestCount} гостей • `}
                                            #{order.id}
                                        </p>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-2">
                                        <p className="text-lg sm:text-2xl font-bold text-gray-900">{(order.totalAmount / 1000).toFixed(0)}к</p>
                                        <p className="text-[10px] sm:text-xs text-gray-500">
                                            {new Date(order.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>

                                {/* Items Preview */}
                                <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 sm:mb-3">
                                    {order.items.slice(0, 3).map((item) => (
                                        <span
                                            key={item.id}
                                            className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg ${item.status === 'served' ? 'bg-green-100 text-green-700' :
                                                    item.status === 'ready' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-gray-100 text-gray-700'
                                                }`}
                                        >
                                            {item.quantity}× {item.product.name.slice(0, 10)}
                                        </span>
                                    ))}
                                    {order.items.length > 3 && (
                                        <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 bg-gray-100 text-gray-500 rounded-lg">
                                            +{order.items.length - 3}
                                        </span>
                                    )}
                                </div>

                                {/* Progress */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-sm">
                                        {pendingItems > 0 && (
                                            <span className="text-yellow-600">
                                                ⏳ {pendingItems}
                                            </span>
                                        )}
                                        {servedItems > 0 && (
                                            <span className="text-green-600">
                                                ✓ {servedItems}
                                            </span>
                                        )}
                                    </div>
                                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Bottom Action Bar */}
            <div className="fixed bottom-0 right-0 left-0 md:left-64 bg-white border-t border-gray-200 p-2 sm:p-4 z-40 safe-area-bottom">
                <div className="max-w-4xl mx-auto">
                    <button
                        onClick={() => router.push('/restaurant')}
                        className="w-full h-10 sm:h-12 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-1 sm:gap-2 text-sm sm:text-base"
                    >
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        К столам
                    </button>
                </div>
            </div>
        </div>
    );
}
