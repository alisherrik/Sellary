'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import PurchaseOrderEditor from '@/components/purchase-orders/PurchaseOrderEditor';
import { useSuppliers } from '@/hooks/useQueries';
import { purchaseOrdersApi } from '@/lib/api';
import type { PurchaseOrderPayload } from '@/lib/types';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: suppliers = [], isLoading, isError } = useSuppliers({ limit: 200 });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-white" />;
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">
        Не удалось загрузить поставщиков. Обновите страницу и попробуйте снова.
      </div>
    );
  }

  return (
    <PurchaseOrderEditor
      suppliers={suppliers}
      onSave={async (payload: PurchaseOrderPayload, id) => {
        const response = id
          ? await purchaseOrdersApi.update(id, payload)
          : await purchaseOrdersApi.create(payload);
        await queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
        return response.data;
      }}
      onSend={async (id) => {
        const response = await purchaseOrdersApi.send(id);
        await queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
        return response.data;
      }}
      onComplete={(order) => router.push(`/purchase-orders/${order.id}`)}
      onCancel={() => router.push('/purchase-orders')}
    />
  );
}
