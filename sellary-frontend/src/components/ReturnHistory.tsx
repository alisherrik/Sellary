'use client';

import { SaleReturn } from '../types';

interface ReturnHistoryProps {
    returns: SaleReturn[];
    loading: boolean;
}

export default function ReturnHistory({ returns, loading }: ReturnHistoryProps) {
    if (loading) {
        return (
            <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500"></div>
            </div>
        );
    }

    if (returns.length === 0) {
        return (
            <div className="text-center py-6 text-slate-500 dark:text-slate-400">
                Нет записей о возвратах
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {returns.map((ret) => (
                <div
                    key={ret.id}
                    className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl"
                >
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                                Возврат #{ret.id}
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {ret.user_name} • {new Date(ret.created_at).toLocaleString()}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="font-bold text-orange-600 dark:text-orange-400">
                                -${ret.total_refund_amount}
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 capitalize">
                                {ret.refund_method}
                            </p>
                        </div>
                    </div>

                    {/* Returned Items */}
                    <div className="border-t border-slate-200 dark:border-slate-600 pt-3 mt-3">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                            ВОЗВРАЩЕННЫЕ ТОВАРЫ
                        </p>
                        <div className="space-y-2">
                            {ret.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex justify-between text-sm"
                                >
                                    <span className="text-slate-700 dark:text-slate-300">
                                        {item.product_name} × {item.quantity_returned}
                                    </span>
                                    <span className="text-slate-600 dark:text-slate-400">
                                        ${item.refund_amount}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Notes */}
                    {ret.notes && (
                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
                            <p className="text-sm text-slate-600 dark:text-slate-400 italic">
                                {ret.notes}
                            </p>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
