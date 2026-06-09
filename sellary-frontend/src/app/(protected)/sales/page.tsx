'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  EyeIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { salesApi, metaApi, generateIdempotencyKey } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { TableSkeleton } from '@/components/skeletons';
import { Sale, SaleItem } from '@/lib/types';
import { useSales } from '@/hooks/useQueries';

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
    mutationFn: async (data: { saleId: number; payload: any; idempotencyKey: string }) =>
      salesApi.processReturn(data.saleId, data.payload, data.idempotencyKey),
    onSuccess: () => {
      toast.success('Возврат успешно оформлен');
      setShowReturnModal(false);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setShowDetailModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Ошибка при оформлении возврата');
    },
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
        .filter((item: any) => item.transaction_type === 'sale' && (item.quantity - (item.quantity_returned || 0)) > 0)
        .map((item: any) => {
          const maxQty =
            item.quantity_returnable !== undefined
              ? item.quantity_returnable
              : item.quantity - (item.quantity_returned || 0);
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
    if (!selectedSale || !hasSelectedItems) {
      return;
    }

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
      idempotencyKey,
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
      completed: 'Завершен',
      partially_returned: 'Частичный возврат',
      returned: 'Возвращен',
      cancelled: 'Отменен',
    };
    return texts[status] || status;
  };

  const getItemById = (id: number): SaleItem | undefined =>
    selectedSale?.items.find((item) => item.id === id);

  return (
    <>
      <div className="h-full overflow-y-auto mobile-no-overscroll p-4">
        <div className="flex items-center justify-end">
          <button
            onClick={() => refetch()}
            className="flex items-center justify-center gap-2 self-start rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 sm:self-auto sm:px-4 sm:text-base"
          >
            <ArrowPathIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={5} columns={5} />
            </div>
          ) : sales.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Продажи не найдены</div>
          ) : (
            <>
              <div className="divide-y divide-gray-100 dark:divide-gray-700 sm:hidden">
                {sales.map((sale: any) => (
                  <div key={sale.id} className="p-3 active:bg-gray-50">
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">Чек #{sale.id}</p>
                        <p className="text-[10px] text-gray-500">{new Date(sale.created_at).toLocaleString('ru-RU')}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusBadge(sale.status)}`}>
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
                          className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </button>
                        {sale.can_return && (
                          <button
                            onClick={() => handleOpenReturnModal(sale)}
                            className="rounded-lg p-2 text-orange-600 hover:bg-orange-50"
                          >
                            <ArrowUturnLeftIcon className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
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
                          {new Date(sale.created_at).toLocaleString('ru-RU')}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{sale.cashier_name}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {formatCurrency(sale.total_amount)}
                        </td>
                        <td className="px-4 py-3 text-sm text-orange-600 dark:text-orange-400">
                          {parseFloat(sale.refunded_amount) > 0 ? `-${formatCurrency(sale.refunded_amount)}` : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusBadge(sale.status)}`}>
                            {getStatusText(sale.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleViewSale(sale)}
                              className="rounded-lg p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900"
                              title="Подробнее"
                            >
                              <EyeIcon className="h-5 w-5" />
                            </button>
                            {sale.can_return && (
                              <button
                                onClick={() => handleOpenReturnModal(sale)}
                                className="rounded-lg p-2 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900"
                                title="Оформить возврат"
                              >
                                <ArrowUturnLeftIcon className="h-5 w-5" />
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

      {showDetailModal && selectedSale && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:max-w-3xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6 sm:py-4">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white sm:text-xl">Продажа #{selectedSale.id}</h2>
                <p className="text-[10px] text-gray-500 sm:text-sm">
                  {new Date(selectedSale.created_at).toLocaleString('ru-RU')}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium sm:px-3 sm:py-1 sm:text-sm ${getStatusBadge(selectedSale.status)}`}>
                {getStatusText(selectedSale.status)}
              </span>
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4 sm:space-y-6 sm:p-6">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 sm:gap-4">
                <div className="rounded-xl bg-gray-50 p-2 dark:bg-slate-700 sm:p-3">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs">Итого</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white sm:text-lg">
                    {formatCurrency(selectedSale.total_amount)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-2 dark:bg-slate-700 sm:p-3">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs">Возврат</p>
                  <p className="text-sm font-bold text-orange-600 sm:text-lg">
                    {formatCurrency((selectedSale as any).refunded_amount || '0')}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-2 dark:bg-slate-700 sm:p-3">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs">Остаток</p>
                  <p className="text-sm font-bold text-green-600 sm:text-lg">
                    {formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-2 dark:bg-slate-700 sm:p-3">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs">Оплата</p>
                  <p className="text-sm font-bold capitalize text-gray-900 dark:text-white sm:text-lg">
                    {selectedSale.payment_method}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white sm:mb-3 sm:text-base">Товары</h3>
                <div className="space-y-2">
                  {selectedSale.items.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl bg-gray-50 p-2 dark:bg-slate-700 sm:p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-900 dark:text-white sm:text-base">
                          {item.product_name}
                        </p>
                        <p className="text-[10px] text-gray-500 sm:text-sm">
                          {item.quantity} {item.uom} × {formatCurrency(item.unit_price)}
                          {item.quantity_returned > 0 && (
                            <span className="ml-1 text-orange-600 sm:ml-2">({item.quantity_returned} возв.)</span>
                          )}
                        </p>
                      </div>
                      <div className="ml-2 flex-shrink-0 text-right">
                        <p className="text-xs font-medium text-gray-900 dark:text-white sm:text-base">
                          {formatCurrency(item.total)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white sm:mb-3 sm:text-base">
                  История возвратов
                </h3>
                {returnsLoading ? (
                  <p className="py-4 text-center text-sm text-gray-500">Загрузка...</p>
                ) : returns.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-500 sm:text-sm">Возвратов нет</p>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {returns.map((ret) => (
                      <div key={ret.id} className="rounded-xl bg-orange-50 p-2 dark:bg-orange-900/20 sm:p-4">
                        <div className="mb-1 flex justify-between sm:mb-2">
                          <span className="text-xs font-medium text-gray-900 dark:text-white sm:text-sm">
                            Возврат #{ret.id}
                          </span>
                          <span className="text-xs font-bold text-orange-600 sm:text-sm">
                            -{formatCurrency(ret.total_refund_amount)}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-500 sm:text-xs">
                          {ret.user_name} • {new Date(ret.created_at).toLocaleString('ru-RU')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700 sm:flex-row sm:px-6 sm:py-4">
              {(selectedSale as any).can_return && (
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    handleOpenReturnModal(selectedSale);
                  }}
                  className="flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm text-white hover:bg-orange-600 sm:text-base"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  Оформить возврат
                </button>
              )}
              <button
                onClick={() => setShowDetailModal(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 sm:ml-auto sm:text-base"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && selectedSale && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:max-w-2xl sm:rounded-2xl">
            <div className="border-b border-slate-200 bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3 dark:border-slate-700 sm:px-6 sm:py-4">
              <h2 className="text-base font-bold text-white sm:text-xl">Возврат #{selectedSale.id}</h2>
              <p className="text-[10px] text-white/80 sm:text-sm">
                Доступно: {formatCurrency((selectedSale as any).remaining_refundable_amount || '0')}
              </p>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-4 sm:p-6">
              <div className="mb-4 space-y-2 sm:mb-6 sm:space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 sm:text-base">
                  Товары для возврата
                </h3>
                {returnQuantities.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Нет товаров для возврата</p>
                ) : (
                  returnQuantities.map((rq) => {
                    const item = getItemById(rq.saleItemId);
                    if (!item) {
                      return null;
                    }

                    return (
                      <div
                        key={rq.saleItemId}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-700/50 sm:p-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200 sm:text-base">
                            {item.product_name}
                          </p>
                          <p className="text-[10px] text-slate-500 sm:text-sm">Доступно: {rq.maxQuantity}</p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
                          <button
                            type="button"
                            onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity - 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-sm font-bold hover:bg-slate-300 dark:bg-slate-600 sm:h-8 sm:w-8"
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
                            className="w-10 rounded-lg border border-slate-300 bg-white py-1 text-center text-sm dark:border-slate-600 dark:bg-slate-700 sm:w-16"
                          />
                          <button
                            type="button"
                            onClick={() => handleQuantityChange(rq.saleItemId, rq.quantity + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-sm font-bold hover:bg-slate-300 dark:bg-slate-600 sm:h-8 sm:w-8"
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
                <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300 sm:text-sm">
                  Способ возврата
                </label>
                <select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 sm:px-4 sm:py-2.5 sm:text-base"
                >
                  {refundMethods.map((method) => (
                    <option key={method} value={method}>
                      {method.charAt(0).toUpperCase() + method.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300 sm:text-sm">
                  Примечание
                </label>
                <textarea
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Причина возврата..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 sm:px-4 sm:py-2.5 sm:text-base"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700 sm:flex-row sm:gap-3 sm:px-6 sm:py-4">
              <button
                onClick={() => setShowReturnModal(false)}
                className="order-2 rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 sm:order-1 sm:text-base"
                disabled={returnMutation.isPending}
              >
                Отмена
              </button>
              <button
                onClick={handleSubmitReturn}
                disabled={returnMutation.isPending || !hasSelectedItems}
                className="order-1 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-sm font-semibold text-white hover:from-orange-600 hover:to-red-600 disabled:opacity-50 sm:order-2 sm:px-6 sm:text-base"
              >
                {returnMutation.isPending ? 'Обработка...' : 'Подтвердить возврат'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
