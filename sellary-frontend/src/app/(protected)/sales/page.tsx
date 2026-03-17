'use client';

import { useState } from 'react';
import { salesApi, metaApi, generateIdempotencyKey } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
    ArrowPathIcon,
    EyeIcon,
    ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';

import { TableSkeleton } from '@/components/skeletons';
import toast from 'react-hot-toast';
import { Sale, SaleItem } from '@/lib/types';
import { useSales } from '@/hooks/useQueries';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import OfflineGuard from '@/components/OfflineGuard';

interface SaleReturnItem {
    id: number;
    sale_item_id: number;
    product_name: string;
    quantity_returned: number;
    refund_amount: string;
}

interface SaleReturn {
    id: number;
    sale_id: number;
    user_id: number;
    user_name: string;
    total_refund_amount: string;
    refund_method: string;
    notes?: string;
    created_at: string;
    items: SaleReturnItem[];
}

interface ReturnQuantity {
    saleItemId: number;
    quantity: number;
    maxQuantity: number;
}

export default function SalesHistory() {
    const queryClient = useQueryClient();
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [returns, setReturns] = useState<SaleReturn[]>([]);
    const [returnsLoading, setReturnsLoading] = useState(false);

    const [refundMethods, setRefundMethods] = useState<string[]>([]);
    const [returnQuantities, setReturnQuantities] = useState<ReturnQuantity[]>([]);
    const [refundMethod, setRefundMethod] = useState('');
    const [returnNotes, setReturnNotes] = useState('');

    const { data: sales = [], isLoading: loading, refetch } = useSales({ limit: 100 });

    const returnMutation = useMutation({
        mutationFn: async (data: { saleId: number; payload: any; idempotencyKey: string }) => {
            return salesApi.processReturn(data.saleId, data.payload, data.idempotencyKey);
        },
        onSuccess: () => {
            toast.success('Возврат успешно оформлен');
            setShowReturnModal(false);
            queryClient.invalidateQueries({ queryKey: ['sales'] });
            setShowDetailModal(false);
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Ошибка при оформлении возврата');
        }
    });

    const handleViewSale = async (sale: Sale) => {
        setSelectedSale(sale);
        setShowDetailModal(true);
        setReturnsLoading(true);
        try {
            const res = await salesApi.getReturns(sale.id);
            setReturns(res.data);
        } catch {
            setReturns([]);
        } finally {
            setReturnsLoading(false);
        }
    };

    const handleOpenReturnModal = async (sale: Sale) => {
        setSelectedSale(sale);
        setReturnNotes('');
        setReturnQuantities(
            sale.items
                .filter((item) => item.transaction_type === 'sale' && (item.quantity - (item.quantity_returned || 0)) > 0)
                .map((item: any) => {
                    const maxQty = item.quantity_returnable !== undefined ? item.quantity_returnable : (item.quantity - (item.quantity_returned || 0));
                    return {
                        saleItemId: item.id,
                        quantity: 0,
                        maxQuantity: maxQty,
                    };
                })
                .filter((rq) => rq.maxQuantity > 0)
        );
        try {
            const res = await metaApi.getSaleReturnOptions();
            setRefundMethods(res.data.refund_methods);
            setRefundMethod(res.data.refund_methods[0] || 'cash');
        } catch {
            setRefundMethods(['cash', 'card', 'mobile']);
            setRefundMethod('cash');
        }
        setShowReturnModal(true);
    };

    const handleQuantityChange = (saleItemId: number, value: number) => {
        setReturnQuantities((prev) =>
            prev.map((rq) =>
                rq.saleItemId === saleItemId
                    ? { ...rq, quantity: Math.min(Math.max(0, value), rq.maxQuantity) }
                    : rq
            )
        );
    };

    const hasSelectedItems = returnQuantities.some((rq) => rq.quantity > 0);

    const handleSubmitReturn = () => {
        if (!selectedSale || !hasSelectedItems) return;
        const itemsToReturn = returnQuantities
            .filter((rq) => rq.quantity > 0)
            .map((rq) => ({
                sale_item_id: rq.saleItemId,
                quantity: rq.quantity,
            }));
        const idempotencyKey = generateIdempotencyKey();
        returnMutation.mutate({
            saleId: selectedSale.id,
            payload: {
                items: itemsToReturn,
                refund_method: refundMethod,
                notes: returnNotes || undefined,
            },
            idempotencyKey
        });
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            completed: 'bg-green-100 text-green-800',
            partially_returned: 'bg-orange-100 text-orange-800',
            returned: 'bg-red-100 text-red-800',
            cancelled: 'bg-gray-100 text-gray-800',
        };
        return styles[status] || styles.completed;
    };

    const getStatusText = (status: string) => {
        const texts: Record<string, string> = {
            completed: 'Завершён',
            partially_returned: 'Частичный',
            returned: 'Возврат',
            cancelled: 'Отменён',
        };
        return texts[status] || status;
    };

    const getItemById = (id: number): SaleItem | undefined =>
        selectedSale?.items.find((item) => item.id === id);

    return (
        <OfflineGuard>
            <div className="space-y-4 sm:space-y-6 pb-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">История продаж</h1>
                        <p className="text-xs sm:text-base text-gray-600 dark:text-gray-400">Просмотр и управление продажами</p>
                    </div>
                    <button
                        onClick={() => refetch()}
                        className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm sm:text-base self-start sm:self-auto"
                    >
                        <ArrowPathIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">Обновить</span>
                    </button>
                </div>

                {/* Mobile Cards / Desktop Table */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    {loading ? (
                        <div className="p-4">
                            <TableSkeleton rows={5} columns={5} />
                        </div>
                    ) : sales.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            Продаж не найдено
                        </div>
                    ) : (
                        <>
                            {/* Mobile View - Cards */}
                            <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                                {sales.map((sale: any) => (
                                    <div key={sale.id} className="p-3 active:bg-gray-50">
                                        <div className="flex items-start justify-between mb-2">
                                            <div>
                                                <p className="font-semibold text-gray-900 dark:text-white text-sm">Чек #{sale.id}</p>
                                                <p className="text-[10px] text-gray-500">{new Date(sale.created_at).toLocaleString('ru-RU')}</p>
                                            </div>
                                            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${getStatusBadge(sale.status)}`}>
                                                {getStatusText(sale.status)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(sale.total_amount)}</p>
                                                {parseFloat(sale.refunded_amount) > 0 && (
                                                    <p className="text-[10px] text-orange-600">-{formatCurrency(sale.refunded_amount)}</p>
                                                )}
                                            </div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => handleViewSale(sale)}
                                                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                                                >
                                                    <EyeIcon className="w-5 h-5" />
                                                </button>
                                                {sale.can_return && (
                                                    <button
                                                        onClick={() => handleOpenReturnModal(sale)}
                                                        className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg"
                                                    >
                                                        <ArrowUturnLeftIcon className="w-5 h-5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop View - Table */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50 dark:bg-gray-700">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">ID</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Дата</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Кассир</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Итого</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Возврат</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Статус</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Действия</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {sales.map((sale: any) => (
                                            <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">#{sale.id}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                                                    {new Date(sale.created_at).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{sale.cashier_name}</td>
                                                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                                    {formatCurrency(sale.total_amount)}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-orange-600 dark:text-orange-400">
                                                    {parseFloat(sale.refunded_amount) > 0 ? `-${formatCurrency(sale.refunded_amount)}` : '-'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(sale.status)}`}>
                                                        {getStatusText(sale.status)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleViewSale(sale)}
                                                            className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 rounded-lg"
                                                            title="Подробнее"
                                                        >
                                                            <EyeIcon className="w-5 h-5" />
                                                        </button>
                                                        {sale.can_return && (
                                                            <button
                                                                onClick={() => handleOpenReturnModal(sale)}
                                                                className="p-2 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900 rounded-lg"
                                                                title="Вернуть товары"
                                                            >
                                                                <ArrowUturnLeftIcon className="w-5 h-5" />
                                                            </button>
                                                        )}
                                                    </div>
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

            {/* Sale Detail Modal */}
            {
                showDetailModal && selectedSale && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4">
                        <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[90vh] overflow-hidden">
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                                <div>
                                    <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">Продажа #{selectedSale.id}</h2>
                                    <p className="text-[10px] sm:text-sm text-gray-500">{new Date(selectedSale.created_at).toLocaleString()}</p>
                                </div>
                                <span className={`px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-sm font-medium rounded-full ${getStatusBadge(selectedSale.status)}`}>
                                    {getStatusText(selectedSale.status)}
                                </span>
                            </div>

                            <div className="p-4 sm:p-6 overflow-y-auto max-h-[60vh] space-y-4 sm:space-y-6">
                                {/* Sale Summary - 2x2 on mobile */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                                    <div className="bg-gray-50 dark:bg-slate-700 p-2 sm:p-3 rounded-xl">
                                        <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Итого</p>
                                        <p className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(selectedSale.total_amount)}</p>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-slate-700 p-2 sm:p-3 rounded-xl">
                                        <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Возврат</p>
                                        <p className="text-sm sm:text-lg font-bold text-orange-600">{formatCurrency((selectedSale as any).refunded_amount || '0')}</p>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-slate-700 p-2 sm:p-3 rounded-xl">
                                        <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Остаток</p>
                                        <p className="text-sm sm:text-lg font-bold text-green-600">{formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}</p>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-slate-700 p-2 sm:p-3 rounded-xl">
                                        <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Оплата</p>
                                        <p className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white capitalize">{selectedSale.payment_method}</p>
                                    </div>
                                </div>

                                {/* Items */}
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white mb-2 sm:mb-3 text-sm sm:text-base">Товары</h3>
                                    <div className="space-y-2">
                                        {selectedSale.items.map((item: any) => (
                                            <div key={item.id} className="flex justify-between items-center p-2 sm:p-3 bg-gray-50 dark:bg-slate-700 rounded-xl">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-medium text-gray-900 dark:text-white text-xs sm:text-base truncate">{item.product_name}</p>
                                                    <p className="text-[10px] sm:text-sm text-gray-500">
                                                        {item.quantity} × {formatCurrency(item.unit_price)}
                                                        {item.quantity_returned > 0 && (
                                                            <span className="text-orange-600 ml-1 sm:ml-2">({item.quantity_returned} возв.)</span>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="text-right flex-shrink-0 ml-2">
                                                    <p className="font-medium text-gray-900 dark:text-white text-xs sm:text-base">{formatCurrency(item.total)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Return History */}
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white mb-2 sm:mb-3 text-sm sm:text-base">История возвратов</h3>
                                    {returnsLoading ? (
                                        <p className="text-center text-gray-500 py-4 text-sm">Загрузка...</p>
                                    ) : returns.length === 0 ? (
                                        <p className="text-center text-gray-500 py-4 text-xs sm:text-sm">Нет возвратов</p>
                                    ) : (
                                        <div className="space-y-2 sm:space-y-3">
                                            {returns.map((ret) => (
                                                <div key={ret.id} className="p-2 sm:p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                                                    <div className="flex justify-between mb-1 sm:mb-2">
                                                        <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">Возврат #{ret.id}</span>
                                                        <span className="text-xs sm:text-sm font-bold text-orange-600">-{formatCurrency(ret.total_refund_amount)}</span>
                                                    </div>
                                                    <p className="text-[10px] sm:text-xs text-gray-500">
                                                        {ret.user_name} • {new Date(ret.created_at).toLocaleString()}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between gap-2 sm:gap-0">
                                {(selectedSale as any).can_return && (
                                    <button
                                        onClick={() => {
                                            setShowDetailModal(false);
                                            handleOpenReturnModal(selectedSale);
                                        }}
                                        className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center justify-center gap-2 text-sm sm:text-base"
                                    >
                                        <ArrowUturnLeftIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                        Вернуть
                                    </button>
                                )}
                                <button
                                    onClick={() => setShowDetailModal(false)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg sm:ml-auto text-sm sm:text-base"
                                >
                                    Закрыть
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Return Modal */}
            {
                showReturnModal && selectedSale && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4">
                        <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-hidden">
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-orange-500 to-red-500">
                                <h2 className="text-base sm:text-xl font-bold text-white">Возврат #{selectedSale.id}</h2>
                                <p className="text-white/80 text-[10px] sm:text-sm">Доступно: {formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}</p>
                            </div>

                            <div className="p-4 sm:p-6 overflow-y-auto max-h-[60vh]">
                                <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                                    <h3 className="font-semibold text-slate-700 dark:text-slate-200 text-sm sm:text-base">Товары для возврата</h3>
                                    {returnQuantities.length === 0 ? (
                                        <p className="text-slate-500 text-center py-4 text-sm">Нет товаров</p>
                                    ) : (
                                        returnQuantities.map((rq) => {
                                            const item = getItemById(rq.saleItemId);
                                            if (!item) return null;
                                            return (
                                                <div key={rq.saleItemId} className="flex items-center justify-between p-2 sm:p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-slate-800 dark:text-slate-200 text-xs sm:text-base truncate">{item.product_name}</p>
                                                        <p className="text-[10px] sm:text-sm text-slate-500">
                                                            Доступно: {rq.maxQuantity}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity - 1)}
                                                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 flex items-center justify-center font-bold text-sm"
                                                            disabled={rq.quantity <= 0}
                                                        >
                                                            -
                                                        </button>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={rq.maxQuantity}
                                                            value={rq.quantity}
                                                            onChange={(e) => handleQuantityChange(rq.saleItemId, parseInt(e.target.value) || 0)}
                                                            className="w-10 sm:w-16 text-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 py-1 text-sm"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity + 1)}
                                                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 flex items-center justify-center font-bold text-sm"
                                                            disabled={rq.quantity >= rq.maxQuantity}
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                <div className="mb-3 sm:mb-4">
                                    <label className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Способ возврата</label>
                                    <select
                                        value={refundMethod}
                                        onChange={(e) => setRefundMethod(e.target.value)}
                                        className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 py-2 sm:py-2.5 px-3 sm:px-4 text-sm sm:text-base"
                                    >
                                        {refundMethods.map((method) => (
                                            <option key={method} value={method}>
                                                {method.charAt(0).toUpperCase() + method.slice(1)}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Примечание</label>
                                    <textarea
                                        value={returnNotes}
                                        onChange={(e) => setReturnNotes(e.target.value)}
                                        placeholder="Причина возврата..."
                                        rows={2}
                                        className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 py-2 sm:py-2.5 px-3 sm:px-4 resize-none text-sm sm:text-base"
                                    />
                                </div>
                            </div>

                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
                                <button
                                    onClick={() => setShowReturnModal(false)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-sm sm:text-base order-2 sm:order-1"
                                    disabled={returnMutation.isPending}
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={handleSubmitReturn}
                                    disabled={returnMutation.isPending || !hasSelectedItems}
                                    className="px-4 sm:px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-red-600 disabled:opacity-50 text-sm sm:text-base order-1 sm:order-2"
                                >
                                    {returnMutation.isPending ? 'Обработка...' : 'Подтвердить возврат'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

        </OfflineGuard>
    );
}
