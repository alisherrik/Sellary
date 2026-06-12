import type { PurchaseOrderStatus } from '@/lib/types';

const statusConfig = {
  draft: { label: 'Черновик', className: 'bg-gray-100 text-gray-800' },
  sent: { label: 'Отправлен', className: 'bg-blue-50 text-blue-700' },
  partially_received: {
    label: 'Частично получен',
    className: 'bg-blue-50 text-blue-700',
  },
  received: { label: 'Получен', className: 'bg-green-50 text-green-700' },
  cancelled: { label: 'Отменён', className: 'bg-red-50 text-red-700' },
} satisfies Record<
  PurchaseOrderStatus,
  { label: string; className: string }
>;

export const getPurchaseOrderStatusLabel = (status: PurchaseOrderStatus) =>
  statusConfig[status].label;

export default function PurchaseOrderStatusBadge({
  status,
}: {
  status: PurchaseOrderStatus;
}) {
  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}
