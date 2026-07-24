import type { PurchaseOrderStatus } from '@/lib/types';

const statusConfig = {
  draft: { label: 'Черновик', className: 'bg-gray-100 text-gray-700' },
  sent: { label: 'Отправлен', className: 'bg-[var(--erp-badge-bg)] text-[var(--erp-badge-text)]' },
  partially_received: {
    label: 'Частично получен',
    className: 'bg-[var(--erp-badge-bg)] text-[var(--erp-badge-text)]',
  },
  received: { label: 'Получен', className: 'bg-green-50 text-[var(--erp-success)]' },
  cancelled: { label: 'Отменён', className: 'bg-red-50 text-[var(--erp-accent)]' },
} satisfies Record<
  PurchaseOrderStatus,
  { label: string; className: string }
>;

export const getPurchaseOrderStatusLabel = (status: PurchaseOrderStatus) =>
  statusConfig[status].label;

export default function PurchaseOrderStatusBadge({
  status,
  voided = false,
}: {
  status: PurchaseOrderStatus;
  voided?: boolean;
}) {
  const config = voided
    ? { label: 'Аннулирована', className: 'bg-red-50 text-[var(--erp-accent)]' }
    : statusConfig[status];

  return (
    <span
      className={`inline-flex px-2 py-1 text-xs font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}
