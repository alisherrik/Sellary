'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import PurchaseOrderReceiveStage from '@/components/purchase-orders/PurchaseOrderReceiveStage';
import AnnulmentDialog from '@/components/transactions/AnnulmentDialog';
import PurchaseOrderStatusBadge from '@/components/purchase-orders/PurchaseOrderStatusBadge';
import PurchaseOrderStepper, {
  type PurchaseOrderStep,
} from '@/components/purchase-orders/PurchaseOrderStepper';
import { getRemainingQuantity } from '@/features/purchase-orders/purchaseOrderForm';
import { usePurchaseOrder } from '@/hooks/useQueries';
import { purchaseOrdersApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { ReceivePurchaseOrderPayload, VoidPreview } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const orderQuery = usePurchaseOrder(id, { enabled: validId });
  const [actionError, setActionError] = useState('');
  const [isActing, setIsActing] = useState(false);
  const [voidPreview, setVoidPreview] = useState<VoidPreview | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidLoading, setVoidLoading] = useState(false);
  const [itemVoidPreview, setItemVoidPreview] = useState<VoidPreview | null>(null);
  const [voidItemId, setVoidItemId] = useState<number | null>(null);
  const [itemVoidLoading, setItemVoidLoading] = useState(false);
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');

  if (!validId) return <DetailError message="Некорректный номер закупки." />;
  if (orderQuery.isLoading) return <div className="h-72 animate-pulse rounded-lg bg-white" />;
  if (orderQuery.isError || !orderQuery.data) {
    return <DetailError message="Закупка не найдена или недоступна." />;
  }

  const order = orderQuery.data;
  const totalOrdered = order.items.reduce(
    (sum, item) => sum + Number(item.quantity_ordered),
    0,
  );
  const totalReceived = order.items.reduce(
    (sum, item) => sum + Number(item.quantity_received),
    0,
  );
  const totalRemaining = order.items.reduce(
    (sum, item) => sum + getRemainingQuantity(item),
    0,
  );
  const progress = totalOrdered ? Math.round((totalReceived / totalOrdered) * 100) : 0;
  const currentStep: PurchaseOrderStep = ['sent', 'partially_received', 'received'].includes(
    order.status,
  )
    ? 'receive'
    : 'review';

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder'] }),
      orderQuery.refetch(),
    ]);
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    setIsActing(true);
    setActionError('');
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error: any) {
      if (error?.response?.status === 409) await refresh();
      const message = error?.response?.data?.detail || 'Операция не выполнена';
      setActionError(message);
      toast.error(message);
    } finally {
      setIsActing(false);
    }
  };

  const openVoidDialog = async () => {
    setVoidPreview(null);
    setShowVoidDialog(true);
    setVoidLoading(true);
    try {
      const response = await purchaseOrdersApi.previewVoid(order.id);
      setVoidPreview(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Не удалось проверить аннулирование');
      setShowVoidDialog(false);
    } finally {
      setVoidLoading(false);
    }
  };

  const confirmVoid = async (reason: string) => {
    await runAction(async () => {
      await purchaseOrdersApi.void(order.id, reason);
      setShowVoidDialog(false);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    }, 'Закупка аннулирована, склад пересчитан');
  };

  const openItemVoidDialog = async (itemId: number) => {
    setItemVoidPreview(null);
    setVoidItemId(itemId);
    setItemVoidLoading(true);
    try {
      const response = await purchaseOrdersApi.previewVoidItem(order.id, itemId);
      setItemVoidPreview(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Не удалось проверить аннулирование');
      setVoidItemId(null);
    } finally {
      setItemVoidLoading(false);
    }
  };

  const confirmItemVoid = async (reason: string) => {
    if (voidItemId == null) return;
    const itemId = voidItemId;
    await runAction(async () => {
      await purchaseOrdersApi.voidItem(order.id, itemId, reason);
      setVoidItemId(null);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    }, 'Позиция аннулирована, склад пересчитан');
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/purchase-orders" className="text-sm font-medium text-blue-700 hover:underline">
            Закупки
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Закупка #{order.id}
            </h1>
            <PurchaseOrderStatusBadge status={order.status} voided={Boolean(order.voided_at)} />
          </div>
          <p className="mt-1 text-sm text-gray-500">{order.supplier?.name ?? 'Поставщик не указан'}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {order.status === 'draft' && (
            <>
              <Link
                href={`/purchase-orders/${order.id}/edit`}
                className="inline-flex min-h-11 items-center rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Редактировать
              </Link>
              <button
                type="button"
                disabled={isActing}
                onClick={() =>
                  void runAction(async () => {
                    await purchaseOrdersApi.send(order.id);
                  }, 'Закупка отправлена поставщику')
                }
                className="min-h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Отправить поставщику
              </button>
            </>
          )}
          {['draft', 'sent'].includes(order.status) && (
            <button
              type="button"
              disabled={isActing}
              onClick={() => {
                if (!window.confirm(`Отменить закупку #${order.id}?`)) return;
                void runAction(async () => {
                  await purchaseOrdersApi.cancel(order.id);
                }, 'Закупка отменена');
              }}
              className="min-h-11 rounded-md px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Отменить
            </button>
          )}
          {isAdmin && ['partially_received', 'received'].includes(order.status) && (
            <button
              type="button"
              disabled={isActing || voidLoading}
              onClick={() => void openVoidDialog()}
              className="min-h-11 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Аннулировать закупку
            </button>
          )}
          {order.status === 'draft' && (
            <button
              type="button"
              disabled={isActing}
              onClick={() => {
                if (!window.confirm(`Удалить черновик #${order.id}?`)) return;
                void runAction(async () => {
                  await purchaseOrdersApi.delete(order.id);
                  router.push('/purchase-orders');
                }, 'Черновик удалён');
              }}
              className="min-h-11 rounded-md px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Удалить
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 border-y border-gray-200 bg-white py-4">
        <PurchaseOrderStepper
          mode="detail"
          currentStep={currentStep}
          status={order.status}
        />
      </div>

      {actionError && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 bg-white">
          <div className="grid gap-4 border-y border-gray-200 py-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-gray-500">Поставщик</p>
              <p className="mt-1 font-semibold text-gray-900">{order.supplier?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-500">Дата заказа</p>
              <p className="mt-1 font-semibold text-gray-900">{formatDate(order.order_date)}</p>
            </div>
            <div>
              <p className="text-gray-500">Ожидаемая поставка</p>
              <p className="mt-1 font-semibold text-gray-900">
                {order.expected_delivery_date ? formatDate(order.expected_delivery_date) : 'Не указана'}
              </p>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Товар</th>
                  <th className="px-4 py-3 text-right">Заказано</th>
                  <th className="px-4 py-3 text-right">Получено</th>
                  <th className="px-4 py-3 text-right">Осталось</th>
                  <th className="px-4 py-3 text-right">Цена</th>
                  <th className="px-4 py-3 text-right">Сумма</th>
                  {isAdmin && <th className="px-4 py-3 text-right">Действия</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {order.items.map((item) => {
                  const canVoidItem =
                    isAdmin &&
                    !item.is_voided &&
                    Number(item.quantity_received) > 0 &&
                    ['partially_received', 'received'].includes(order.status);
                  return (
                    <tr key={item.id} className={item.is_voided ? 'bg-gray-50 text-gray-400' : undefined}>
                      <td className="px-4 py-4">
                        <p
                          className={`font-semibold ${
                            item.is_voided ? 'text-gray-400 line-through' : 'text-gray-900'
                          }`}
                        >
                          {item.product?.name ?? `Товар #${item.product_id}`}
                        </p>
                        <p className="text-xs text-gray-500">
                          {[item.product?.barcode, item.product?.uom].filter(Boolean).join(' · ')}
                        </p>
                        {item.is_voided && (
                          <div className="mt-1">
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                              Аннулирован
                            </span>
                            {item.void_reason && (
                              <p className="mt-1 text-xs text-gray-500">Причина: {item.void_reason}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">{item.quantity_ordered}</td>
                      <td className="px-4 py-4 text-right tabular-nums">{item.quantity_received}</td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums">
                        {getRemainingQuantity(item)}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">{formatCurrency(item.unit_cost)}</td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums">
                        {formatCurrency(item.subtotal)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-4 text-right">
                          {canVoidItem ? (
                            <button
                              type="button"
                              disabled={isActing || itemVoidLoading}
                              onClick={() => void openItemVoidDialog(item.id)}
                              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Аннулировать позицию
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {order.notes && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <h2 className="text-sm font-semibold text-gray-900">Примечание</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{order.notes}</p>
            </div>
          )}

          {['sent', 'partially_received'].includes(order.status) && (
            <PurchaseOrderReceiveStage
              order={order}
              onReceive={async (payload: ReceivePurchaseOrderPayload) => {
                const response = await purchaseOrdersApi.receive(order.id, payload);
                await refresh();
                toast.success('Товары приняты');
                return response.data;
              }}
            />
          )}

          {order.status === 'received' && (
            <div className="mt-8 rounded-md border border-green-200 bg-green-50 p-5 text-green-800">
              <h2 className="font-semibold">Поставка полностью принята</h2>
              <p className="mt-1 text-sm">Все {totalReceived} ед. добавлены на склад.</p>
            </div>
          )}
        </main>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Итого</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-blue-600">
            {formatCurrency(order.total_amount)}
          </p>
          <div className="mt-6 border-t border-gray-200 pt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Приёмка</span>
              <span className="font-semibold tabular-nums text-gray-900">{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-blue-600" style={{ width: `${progress}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <dt className="text-gray-500">Заказано</dt>
                <dd className="mt-1 font-bold tabular-nums text-gray-900">{totalOrdered}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Получено</dt>
                <dd className="mt-1 font-bold tabular-nums text-gray-900">{totalReceived}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Осталось</dt>
                <dd className="mt-1 font-bold tabular-nums text-gray-900">{totalRemaining}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <AnnulmentDialog
        open={showVoidDialog}
        title={`Аннулировать закупку #${order.id}`}
        preview={voidPreview}
        loading={voidLoading}
        submitting={isActing}
        onClose={() => setShowVoidDialog(false)}
        onConfirm={(reason) => void confirmVoid(reason)}
      />

      <AnnulmentDialog
        open={voidItemId != null}
        title="Аннулировать позицию"
        preview={itemVoidPreview}
        loading={itemVoidLoading}
        submitting={isActing}
        onClose={() => setVoidItemId(null)}
        onConfirm={(reason) => void confirmItemVoid(reason)}
      />
    </div>
  );
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-6">
      <h1 className="text-xl font-bold text-gray-900">Закупка недоступна</h1>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <Link
        href="/purchase-orders"
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white"
      >
        К списку закупок
      </Link>
    </div>
  );
}
