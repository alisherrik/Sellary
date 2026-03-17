'use client';

import { useRouter, useParams } from 'next/navigation';
import { useRestaurantStore, OrderItem } from '@/lib/restaurant-store';
import { useState, useEffect } from 'react';

const getItemStatusBadge = (status: OrderItem['status']) => {
    switch (status) {
        case 'pending':
            return { text: 'Ожидает', color: 'bg-gray-100 text-gray-700' };
        case 'confirmed':
            return { text: 'Принят', color: 'bg-blue-100 text-blue-700' };
        case 'preparing':
            return { text: 'Готовится', color: 'bg-yellow-100 text-yellow-700' };
        case 'ready':
            return { text: 'Готово', color: 'bg-green-100 text-green-700 animate-pulse' };
        case 'served':
            return { text: 'Подано', color: 'bg-purple-100 text-purple-700' };
        default:
            return { text: status, color: 'bg-gray-100 text-gray-700' };
    }
};

export default function TableDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const tableName = decodeURIComponent(params.tableName as string);

    const {
        activeOrders,
        tables,
        selectTable,
        markItemAsServed,
        markAllAsServed,
        requestBill,
        cancelOrder,
    } = useRestaurantStore();

    const [showCancelModal, setShowCancelModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const order = activeOrders[tableName];
    const table = tables.find(t => t.name === tableName);

    useEffect(() => {
        setTimeout(() => setIsLoading(false), 300);
    }, []);

    const handleAddMore = () => {
        selectTable(tableName);
        router.push('/restaurant/order');
    };

    const handleRequestBill = () => {
        requestBill(tableName);
        router.push(`/restaurant/payment/${encodeURIComponent(tableName)}`);
    };

    const handleCancel = () => {
        cancelOrder(tableName);
        router.push('/restaurant');
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!order || !table) {
        return (
            <div className="text-center py-12">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Заказ не найден</h2>
                <p className="text-sm sm:text-base text-gray-600 mb-4">У этого стола нет активного заказа</p>
                <button
                    onClick={() => router.push('/restaurant')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm sm:text-base"
                >
                    Вернуться к столам
                </button>
            </div>
        );
    }

    const pendingItems = order.items.filter(item => item.status !== 'served');
    const servedItems = order.items.filter(item => item.status === 'served');

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
                    <div className="flex-1 min-w-0">
                        <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{tableName}</h1>
                        <p className="text-xs sm:text-sm text-gray-600 truncate">
                            {order.guestCount && `${order.guestCount} гостей • `}
                            Заказ #{order.id}
                        </p>
                    </div>
                </div>
            </header>

            {/* Order Stats - 2x2 grid */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-4 sm:mb-6">
                <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
                    <p className="text-[10px] sm:text-sm text-gray-500">Сумма</p>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900">{order.totalAmount.toLocaleString()}</p>
                </div>
                <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
                    <p className="text-[10px] sm:text-sm text-gray-500">Позиций</p>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900">{order.items.length} шт</p>
                </div>
                <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
                    <p className="text-[10px] sm:text-sm text-gray-500">Статус</p>
                    <p className={`text-sm sm:text-lg font-semibold truncate ${order.status === 'waiting' ? 'text-yellow-600' :
                            order.status === 'served' ? 'text-purple-600' :
                                order.status === 'paying' ? 'text-orange-600' : 'text-gray-600'
                        }`}>
                        {order.status === 'waiting' ? 'Ожидает' :
                            order.status === 'served' ? 'Обслужен' :
                                order.status === 'paying' ? 'Оплата' : order.status}
                    </p>
                </div>
                <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100">
                    <p className="text-[10px] sm:text-sm text-gray-500">Время</p>
                    <p className="text-sm sm:text-lg font-semibold text-gray-900">
                        {new Date(order.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>
            </div>

            {/* Order Notes */}
            {order.notes && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 sm:p-4 mb-4 sm:mb-6">
                    <p className="text-xs sm:text-sm font-medium text-yellow-800">
                        📝 {order.notes}
                    </p>
                </div>
            )}

            {/* Pending Items */}
            {pendingItems.length > 0 && (
                <div className="mb-4 sm:mb-6">
                    <div className="flex items-center justify-between mb-2 sm:mb-3">
                        <h2 className="text-sm sm:text-lg font-semibold text-gray-900">
                            Ожидает ({pendingItems.length})
                        </h2>
                        <button
                            onClick={() => markAllAsServed(tableName)}
                            className="text-xs sm:text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                            Всё подано
                        </button>
                    </div>
                    <div className="space-y-2 sm:space-y-3">
                        {pendingItems.map((item) => {
                            const statusBadge = getItemStatusBadge(item.status);
                            return (
                                <div
                                    key={item.id}
                                    className={`bg-white rounded-xl p-3 sm:p-4 shadow-sm border ${item.status === 'ready' ? 'border-green-300 bg-green-50' : 'border-gray-100'
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                                <span className="text-sm sm:text-lg font-semibold text-gray-900">
                                                    {item.quantity}×
                                                </span>
                                                <span className="font-medium text-gray-900 text-sm sm:text-base truncate">
                                                    {item.product.name}
                                                </span>
                                                <span className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full font-medium ${statusBadge.color}`}>
                                                    {statusBadge.text}
                                                </span>
                                            </div>
                                            {item.note && (
                                                <p className="text-xs sm:text-sm text-gray-500 mt-1">📝 {item.note}</p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                                            <span className="font-bold text-gray-900 text-xs sm:text-base">
                                                {(Number(item.product.sell_price) * item.quantity).toLocaleString()}
                                            </span>
                                            {item.status !== 'served' && (
                                                <button
                                                    onClick={() => markItemAsServed(tableName, item.id)}
                                                    className="px-2 sm:px-3 py-1.5 sm:py-2 bg-green-100 text-green-700 rounded-lg text-xs sm:text-sm font-medium hover:bg-green-200 transition-colors"
                                                >
                                                    ✓
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Served Items */}
            {servedItems.length > 0 && (
                <div className="mb-4 sm:mb-6">
                    <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-2 sm:mb-3">
                        Подано ({servedItems.length})
                    </h2>
                    <div className="space-y-1.5 sm:space-y-2">
                        {servedItems.map((item) => (
                            <div
                                key={item.id}
                                className="bg-gray-50 rounded-xl p-2.5 sm:p-3 border border-gray-100"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                        <span className="text-gray-500 text-xs sm:text-base">{item.quantity}×</span>
                                        <span className="text-gray-700 text-xs sm:text-base truncate">{item.product.name}</span>
                                        <svg className="w-3 h-3 sm:w-4 sm:h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <span className="text-gray-600 text-xs sm:text-base flex-shrink-0">
                                        {(Number(item.product.sell_price) * item.quantity).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="fixed bottom-0 right-0 left-0 md:left-64 bg-white border-t border-gray-200 p-2 sm:p-4 z-40 safe-area-bottom">
                <div className="max-w-4xl mx-auto grid grid-cols-3 gap-2 sm:gap-3">
                    <button
                        onClick={handleAddMore}
                        className="h-10 sm:h-12 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200 transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base"
                    >
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span className="hidden xs:inline">Добавить</span>
                    </button>
                    <button
                        onClick={handleRequestBill}
                        className="h-10 sm:h-12 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base"
                    >
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span className="hidden xs:inline">Счёт</span>
                    </button>
                    <button
                        onClick={() => setShowCancelModal(true)}
                        className="h-10 sm:h-12 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base"
                    >
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="hidden xs:inline">Отмена</span>
                    </button>
                </div>
            </div>

            {/* Cancel Confirmation Modal */}
            {showCancelModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-4">
                    <div className="bg-white w-full max-w-sm sm:max-w-md rounded-2xl p-4 sm:p-6 animate-scale-in">
                        <div className="text-center mb-4 sm:mb-6">
                            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">Отменить заказ?</h2>
                            <p className="text-sm sm:text-base text-gray-600">
                                Заказ на {order.totalAmount.toLocaleString()} с. для {tableName} будет отменён.
                            </p>
                        </div>

                        <div className="space-y-2 sm:space-y-3">
                            <button
                                onClick={handleCancel}
                                className="w-full h-10 sm:h-12 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors text-sm sm:text-base"
                            >
                                Да, отменить
                            </button>
                            <button
                                onClick={() => setShowCancelModal(false)}
                                className="w-full h-10 sm:h-12 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors text-sm sm:text-base"
                            >
                                Нет, вернуться
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
