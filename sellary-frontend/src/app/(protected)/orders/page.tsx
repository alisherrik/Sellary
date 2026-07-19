'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ordersApi, generateIdempotencyKey } from '@/lib/api';
import { useOrders, useOrder } from '@/hooks/useQueries';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Order, OrderStatus } from '@/lib/types';
import {
  STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  FULFILLMENT_LABELS,
  nextStatusActions,
  canConfirm,
  canCancel,
} from '@/features/orders/orderStatus';

type TabKey = 'new' | 'active' | 'done' | 'cancelled' | 'all';

const TAB_LABELS: Record<TabKey, string> = {
  new: 'Новые',
  active: 'Активные',
  done: 'Завершённые',
  cancelled: 'Отменённые',
  all: 'Все',
};

const ACTIVE_STATUSES: OrderStatus[] = ['confirmed', 'preparing', 'ready', 'delivering'];

function matchesTab(order: Order, tab: TabKey): boolean {
  switch (tab) {
    case 'new': return order.status === 'pending';
    case 'active': return ACTIVE_STATUSES.includes(order.status);
    case 'done': return order.status === 'completed';
    case 'cancelled': return order.status === 'cancelled';
    case 'all': return true;
  }
}

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('new');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isActing, setIsActing] = useState(false);

  const listQuery = useOrders();
  const allOrders = listQuery.data?.items ?? [];
  const filtered = allOrders.filter((o) => matchesTab(o, activeTab));
  const pendingCount = allOrders.filter((o) => o.status === 'pending').length;

  const detailQuery = useOrder(selectedId ?? 0, { enabled: selectedId !== null });
  const order = detailQuery.data;

  const selectOrder = (id: number) => {
    setSelectedId(id);
    setActionError('');
    setShowCancelForm(false);
    setCancelReason('');
  };

  const runAction = async (action: () => Promise<void>, successMsg: string) => {
    setIsActing(true);
    setActionError('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['order'] });
      await detailQuery.refetch();
      toast.success(successMsg);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail ?? 'Произошла ошибка';
      if (status === 409) {
        await detailQuery.refetch();
      }
      setActionError(detail);
      toast.error(detail);
    } finally {
      setIsActing(false);
    }
  };

  const handleConfirm = () => {
    if (!order) return;
    const key = generateIdempotencyKey();
    runAction(
      async () => {
        await ordersApi.confirm(order.id, 'cash', key);
        await queryClient.invalidateQueries({ queryKey: ['products'] });
        await queryClient.invalidateQueries({ queryKey: ['sales'] });
      },
      'Заказ подтверждён',
    );
  };

  const handleAdvance = (target: string) => {
    if (!order) return;
    runAction(
      () => ordersApi.advanceStatus(order.id, target as any).then(() => {}),
      'Статус обновлён',
    );
  };

  const handleCancel = () => {
    if (!order) return;
    runAction(
      () => ordersApi.cancel(order.id, cancelReason || undefined).then(() => {}),
      'Заказ отменён',
    );
  };

  const tabs: TabKey[] = ['new', 'active', 'done', 'cancelled', 'all'];

  return (
    <div className="flex h-full">
      {/* Left panel: filter tabs + list */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b bg-white px-4 pt-4">
          <h1 className="mb-3 text-xl font-semibold text-gray-900">Заказы</h1>
          <div className="flex gap-1" role="tablist">
            {tabs.map((tab) => {
              const count = allOrders.filter((o) => matchesTab(o, tab)).length;
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1 rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {TAB_LABELS[tab]}
                  {tab === 'new' && pendingCount > 0 ? (
                    <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                      {pendingCount}
                    </span>
                  ) : (
                    <span className="ml-1 text-xs text-gray-400">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {listQuery.isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-200" />
              ))}
            </div>
          )}
          {!listQuery.isLoading && filtered.length === 0 && (
            <div className="py-12 text-center text-gray-500">Нет заказов</div>
          )}
          <div className="space-y-2">
            {filtered.map((o) => (
              <button
                key={o.id}
                onClick={() => selectOrder(o.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-gray-50 ${
                  selectedId === o.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-semibold text-gray-900">#{o.order_number}</span>
                    <span className="ml-2 text-sm text-gray-500">{o.contact_name}</span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[o.status]}`}
                  >
                    {STATUS_LABELS[o.status]}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                  <span>{FULFILLMENT_LABELS[o.fulfillment_type]}</span>
                  <span>{formatCurrency(o.total_amount)}</span>
                  <span>{formatDate(o.created_at)}</span>
                  <span>{o.items.length} поз.</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: detail drawer */}
      {selectedId !== null && (
        <div className="flex w-full flex-col border-l bg-white md:w-96 lg:w-[480px]">
          {detailQuery.isLoading && (
            <div className="p-4">
              <div className="h-6 w-1/2 animate-pulse rounded bg-gray-200" />
            </div>
          )}
          {order && (
            <div className="flex flex-1 flex-col overflow-y-auto p-4">
              {/* Header */}
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Заказ #{order.order_number}
                </h2>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              {/* Status badge */}
              <div className="mb-4">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE_CLASSES[order.status]}`}
                >
                  {STATUS_LABELS[order.status]}
                </span>
                <span className="ml-2 text-sm text-gray-500">
                  {FULFILLMENT_LABELS[order.fulfillment_type]}
                </span>
              </div>

              {/* Error alert */}
              {actionError && (
                <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              {/* Actions */}
              <div className="mb-4 flex flex-wrap gap-2">
                {canConfirm(order.status) && (
                  <button
                    disabled={isActing}
                    onClick={handleConfirm}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Подтвердить заказ
                  </button>
                )}
                {nextStatusActions(order.status, order.fulfillment_type).map((action) => (
                  <button
                    key={action.target}
                    disabled={isActing}
                    onClick={() => handleAdvance(action.target)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {action.label}
                  </button>
                ))}
                {canCancel(order.status) && !showCancelForm && (
                  <button
                    disabled={isActing}
                    onClick={() => { setShowCancelForm(true); setActionError(''); }}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Отменить
                  </button>
                )}
              </div>

              {/* Cancel form */}
              {showCancelForm && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Причина отмены
                    <textarea
                      aria-label="Причина отмены"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
                      placeholder="Не обязательно"
                    />
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={isActing}
                      onClick={handleCancel}
                      className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Подтвердить отмену
                    </button>
                    <button
                      onClick={() => { setShowCancelForm(false); setCancelReason(''); }}
                      className="rounded border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Назад
                    </button>
                  </div>
                </div>
              )}

              {/* Customer block */}
              <div className="mb-4 rounded-lg bg-gray-50 p-3">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Покупатель</h3>
                <p className="text-sm text-gray-900">{order.contact_name}</p>
                <p className="text-sm text-gray-600">{order.contact_phone}</p>
                {order.fulfillment_type === 'delivery' && order.delivery_address && (
                  <p className="mt-1 text-sm text-gray-600">{order.delivery_address}</p>
                )}
                {order.notes && (
                  <p className="mt-1 text-xs italic text-gray-500">{order.notes}</p>
                )}
              </div>

              {/* Items table */}
              <div className="flex-1">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Состав заказа</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="pb-1 font-medium">Товар</th>
                      <th className="pb-1 text-right font-medium">Кол.</th>
                      <th className="pb-1 text-right font-medium">Цена</th>
                      <th className="pb-1 text-right font-medium">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100">
                        <td className="py-1.5 text-gray-900">{item.product_name}</td>
                        <td className="py-1.5 text-right text-gray-600">{item.quantity}</td>
                        <td className="py-1.5 text-right text-gray-600">
                          {formatCurrency(item.unit_price)}
                        </td>
                        <td className="py-1.5 text-right font-medium text-gray-900">
                          {formatCurrency(item.line_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="pt-2 text-right text-sm font-semibold text-gray-700">
                        Итого:
                      </td>
                      <td className="pt-2 text-right text-sm font-bold text-gray-900">
                        {formatCurrency(order.total_amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
