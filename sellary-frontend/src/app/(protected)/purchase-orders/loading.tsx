import { TableSkeleton } from '@/components/skeletons';

export default function PurchaseOrdersLoading() {
  return <TableSkeleton rows={5} columns={5} />;
}
