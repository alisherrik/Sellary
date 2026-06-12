'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import PurchaseOrderEditor from '@/components/purchase-orders/PurchaseOrderEditor';
import { usePurchaseOrder, useSuppliers } from '@/hooks/useQueries';
import { purchaseOrdersApi } from '@/lib/api';
import type { PurchaseOrderPayload } from '@/lib/types';

export default function EditPurchaseOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const orderQuery = usePurchaseOrder(id, { enabled: validId });
  const suppliersQuery = useSuppliers({ limit: 200 });

  if (!validId) {
    return <NotAvailable message="Некорректный номер закупки." />;
  }

  if (orderQuery.isLoading || suppliersQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-white" />;
  }

  if (orderQuery.isError || !orderQuery.data) {
    return <NotAvailable message="Закупка не найдена или недоступна." />;
  }

  if (suppliersQuery.isError) {
    return <NotAvailable message="Не удалось загрузить поставщиков." />;
  }

  if (orderQuery.data.status !== 'draft') {
    return (
      <NotAvailable
        message="Редактировать можно только черновик."
        orderId={orderQuery.data.id}
      />
    );
  }

  return (
    <PurchaseOrderEditor
      initialOrder={orderQuery.data}
      suppliers={suppliersQuery.data ?? []}
      onSave={async (payload: PurchaseOrderPayload, orderId) => {
        const response = await purchaseOrdersApi.update(orderId ?? id, payload);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
          queryClient.invalidateQueries({ queryKey: ['purchaseOrder'] }),
        ]);
        return response.data;
      }}
      onSend={async (orderId) => (await purchaseOrdersApi.send(orderId)).data}
      onComplete={(order) => router.push(`/purchase-orders/${order.id}`)}
      onCancel={() => router.push(`/purchase-orders/${id}`)}
    />
  );
}

function NotAvailable({ message, orderId }: { message: string; orderId?: number }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-6">
      <h1 className="text-xl font-bold text-gray-900">Редактирование недоступно</h1>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <Link
        href={orderId ? `/purchase-orders/${orderId}` : '/purchase-orders'}
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white"
      >
        Вернуться
      </Link>
    </div>
  );
}
