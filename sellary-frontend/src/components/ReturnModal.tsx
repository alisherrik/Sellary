'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Sale, SaleItem, SaleReturnOptions } from '../types';
import { salesApi, metaApi, generateIdempotencyKey } from '../api';

interface ReturnModalProps {
    sale: Sale;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface ReturnQuantity {
    saleItemId: number;
    quantity: number;
    maxQuantity: number;
}

export default function ReturnModal({ sale, isOpen, onClose, onSuccess }: ReturnModalProps) {
    const [options, setOptions] = useState<SaleReturnOptions | null>(null);
    const [returnQuantities, setReturnQuantities] = useState<ReturnQuantity[]>([]);
    const [refundMethod, setRefundMethod] = useState<string>('');
    const [notes, setNotes] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [optionsLoading, setOptionsLoading] = useState(false);

    // Load options from backend
    useEffect(() => {
        if (isOpen) {
            setOptionsLoading(true);
            metaApi.getSaleReturnOptions()
                .then((res) => {
                    setOptions(res.data);
                    if (res.data.refund_methods.length > 0) {
                        setRefundMethod(res.data.refund_methods[0]);
                    }
                })
                .catch((err) => {
                    toast.error('Ошибка загрузки опций');
                })
                .finally(() => setOptionsLoading(false));

            // Initialize return quantities from sale items
            setReturnQuantities(
                sale.items
                    .filter((item) => item.can_return)
                    .map((item) => ({
                        saleItemId: item.id,
                        quantity: 0,
                        maxQuantity: item.quantity_returnable,
                    }))
            );
        }
    }, [isOpen, sale.items]);

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

    const handleSubmit = async () => {
        if (!hasSelectedItems) {
            toast.error('Выберите хотя бы один товар');
            return;
        }

        const itemsToReturn = returnQuantities
            .filter((rq) => rq.quantity > 0)
            .map((rq) => ({
                sale_item_id: rq.saleItemId,
                quantity: rq.quantity,
            }));

        setLoading(true);
        try {
            const idempotencyKey = generateIdempotencyKey();
            await salesApi.processReturn(
                sale.id,
                {
                    items: itemsToReturn,
                    refund_method: refundMethod,
                    notes: notes || undefined,
                },
                idempotencyKey
            );
            toast.success('Возврат успешно оформлен');
            onSuccess();
            onClose();
        } catch (err: any) {
            const errorMessage = err.response?.data?.detail || 'Ошибка при оформлении возврата';
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const getItemById = (id: number): SaleItem | undefined =>
        sale.items.find((item) => item.id === id);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-orange-500 to-red-500">
                    <h2 className="text-xl font-bold text-white">Возврат товаров - Продажа #{sale.id}</h2>
                    <p className="text-white/80 text-sm">Доступно для возврата: ${sale.remaining_refundable_amount}</p>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {optionsLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                        </div>
                    ) : (
                        <>
                            {/* Items List */}
                            <div className="space-y-3 mb-6">
                                <h3 className="font-semibold text-slate-700 dark:text-slate-200">Выберите товары для возврата</h3>
                                {returnQuantities.length === 0 ? (
                                    <p className="text-slate-500 dark:text-slate-400 text-center py-4">Нет товаров для возврата</p>
                                ) : (
                                    returnQuantities.map((rq) => {
                                        const item = getItemById(rq.saleItemId);
                                        if (!item) return null;
                                        return (
                                            <div
                                                key={rq.saleItemId}
                                                className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl"
                                            >
                                                <div className="flex-1">
                                                    <p className="font-medium text-slate-800 dark:text-slate-200">{item.product_name}</p>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                                        Продано: {item.quantity} | Возвращено: {item.quantity_returned} | Доступно: {item.quantity_returnable}
                                                    </p>
                                                    <p className="text-sm text-slate-600 dark:text-slate-300">
                                                        Цена за ед.: ${item.unit_price}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity - 1)}
                                                        className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 flex items-center justify-center font-bold"
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
                                                        className="w-16 text-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 py-1 px-2"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity + 1)}
                                                        className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 flex items-center justify-center font-bold"
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

                            {/* Refund Method */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Способ возврата
                                </label>
                                <select
                                    value={refundMethod}
                                    onChange={(e) => setRefundMethod(e.target.value)}
                                    className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 py-2.5 px-4"
                                >
                                    {options?.refund_methods.map((method) => (
                                        <option key={method} value={method}>
                                            {method.charAt(0).toUpperCase() + method.slice(1)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Примечания (необязательно)
                                </label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Причина возврата..."
                                    rows={2}
                                    className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 py-2.5 px-4 resize-none"
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        disabled={loading}
                    >
                        Отмена
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={loading || !hasSelectedItems || optionsLoading}
                        className="px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Обработка...' : 'Подтвердить возврат'}
                    </button>
                </div>
            </div>
        </div>
    );
}
