'use client';

import { useMemo, useState } from 'react';
import { CheckCircleIcon } from '@heroicons/react/20/solid';

import {
  getRemainingQuantity,
  validateReceiveQuantity,
} from '@/features/purchase-orders/purchaseOrderForm';
import type {
  PurchaseOrder,
  ReceivePurchaseOrderPayload,
} from '@/lib/types';

interface PurchaseOrderReceiveStageProps {
  order: PurchaseOrder;
  onReceive: (payload: ReceivePurchaseOrderPayload) => Promise<PurchaseOrder>;
}

export default function PurchaseOrderReceiveStage({
  order,
  onReceive,
}: PurchaseOrderReceiveStageProps) {
  const [receiving, setReceiving] = useState<Record<number, string>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, '0'])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');

  const validation = useMemo(
    () =>
      Object.fromEntries(
        order.items.map((item) => [
          item.id,
          validateReceiveQuantity(
            Number(receiving[item.id] || 0),
            getRemainingQuantity(item),
          ),
        ]),
      ) as Record<number, string | null>,
    [order.items, receiving],
  );

  const totalToReceive = order.items.reduce(
    (sum, item) => sum + (Number(receiving[item.id]) || 0),
    0,
  );
  const selectedLines = order.items.filter(
    (item) => Number(receiving[item.id]) > 0,
  ).length;
  const hasInvalid = Object.values(validation).some(Boolean);
  const canSubmit = totalToReceive > 0 && !hasInvalid && !isSubmitting;

  const receiveAll = () => {
    setReceiving(
      Object.fromEntries(
        order.items.map((item) => [item.id, String(getRemainingQuantity(item))]),
      ),
    );
    setRequestError('');
  };

  const submit = async () => {
    if (!canSubmit) return;
    const payload: ReceivePurchaseOrderPayload = {
      items: order.items.flatMap((item) => {
        const quantity = Number(receiving[item.id] || 0);
        return quantity > 0
          ? [{ item_id: item.id, quantity_to_receive: quantity }]
          : [];
      }),
    };

    setIsSubmitting(true);
    setRequestError('');
    try {
      await onReceive(payload);
    } catch {
      setRequestError('Не удалось принять товары. Введённые количества сохранены.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="receive-title" className="mt-8 border-t border-gray-200 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="receive-title" className="text-xl font-bold text-gray-900">
            Приёмка товара
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Введите только фактически полученное количество. Остаток можно принять позже.
          </p>
        </div>
        <button
          type="button"
          onClick={receiveAll}
          className="min-h-11 rounded-md px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Принять всё оставшееся
        </button>
      </div>

      <div className="mt-5 overflow-hidden border-y border-gray-200">
        <div className="hidden grid-cols-[minmax(220px,1fr)_100px_100px_100px_150px] gap-3 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid">
          <span>Товар</span>
          <span className="text-right">Заказано</span>
          <span className="text-right">Получено</span>
          <span className="text-right">Осталось</span>
          <span className="text-right">Принять сейчас</span>
        </div>
        <div className="divide-y divide-gray-200">
          {order.items.map((item) => {
            const name = item.product?.name ?? `Товар #${item.product_id}`;
            const remaining = getRemainingQuantity(item);
            const error = validation[item.id];
            return (
              <div
                key={item.id}
                className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-[minmax(220px,1fr)_100px_100px_100px_150px] sm:items-start"
              >
                <div>
                  <p className="font-semibold text-gray-900">{name}</p>
                  <p className="text-xs text-gray-500">{item.product?.uom ?? 'ед.'}</p>
                </div>
                <p className="flex justify-between tabular-nums text-gray-700 sm:block sm:pt-3 sm:text-right">
                  <span className="text-gray-500 sm:hidden">Заказано</span>
                  {item.quantity_ordered}
                </p>
                <p className="flex justify-between tabular-nums text-gray-700 sm:block sm:pt-3 sm:text-right">
                  <span className="text-gray-500 sm:hidden">Получено</span>
                  {item.quantity_received}
                </p>
                <p className="flex justify-between font-semibold tabular-nums text-gray-900 sm:block sm:pt-3 sm:text-right">
                  <span className="font-normal text-gray-500 sm:hidden">Осталось</span>
                  {remaining}
                </p>
                <div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600 sm:sr-only">
                      Принять сейчас
                    </span>
                    <input
                      type="number"
                      min="0"
                      max={remaining}
                      step="0.001"
                      disabled={remaining === 0}
                      aria-label={`Принять сейчас, ${name}`}
                      aria-invalid={Boolean(error)}
                      value={receiving[item.id] ?? '0'}
                      onChange={(event) => {
                        setReceiving((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }));
                        setRequestError('');
                      }}
                      className={`min-h-11 w-full rounded-md border bg-white px-3 text-right tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-gray-100 ${
                        error ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                  </label>
                  {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                  {remaining === 0 && (
                    <p className="mt-1 flex items-center justify-end gap-1 text-xs text-green-700">
                      <CheckCircleIcon className="h-4 w-4" /> Получено
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {requestError && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {requestError}
        </div>
      )}

      <div className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white py-4">
        <div>
          <p className="font-semibold tabular-nums text-gray-900">
            Будет принято: {totalToReceive} ед.
          </p>
          <p className="text-xs text-gray-500">Позиций: {selectedLines}</p>
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="min-h-11 rounded-md bg-green-600 px-5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Подтвердить приёмку
        </button>
      </div>
    </section>
  );
}
