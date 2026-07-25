'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import PurchaseOrderEditor from '@/components/purchase-orders/PurchaseOrderEditor';
import { useLowStockProducts, useSuppliers } from '@/hooks/useQueries';
import { purchaseOrdersApi } from '@/lib/api';
import type { PurchaseOrderPayload } from '@/lib/types';
import type { PurchaseOrderItemInput } from '@/features/purchase-orders/purchaseOrderForm';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { data: suppliers = [], isLoading, isError } = useSuppliers({ limit: 200 });

  // Arriving from the reorder list: the draft opens already knowing what the
  // owner came to order, instead of making them search each item back by name.
  const seedFromLowStock = searchParams.get('from') === 'low-stock';
  const { data: lowStock = [], isLoading: lowStockLoading } = useLowStockProducts({
    enabled: seedFromLowStock,
  });

  const seededItems: PurchaseOrderItemInput[] | undefined = seedFromLowStock
    ? lowStock.map((product) => ({
        key: `low-${product.id}`,
        product_id: String(product.id),
        product_name: product.name,
        product_uom: product.uom,
        // What it takes to get back to the minimum, rounded up to a whole unit.
        quantity_ordered: String(
          Math.max(1, Math.ceil(Number(product.min_stock_level) - Number(product.stock_quantity))),
        ),
        unit_cost: String(product.cost_price),
      }))
    : undefined;

  if (isLoading || (seedFromLowStock && lowStockLoading)) {
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
      initialItems={seededItems?.length ? seededItems : undefined}
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
