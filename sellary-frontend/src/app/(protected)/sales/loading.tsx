import { TableSkeleton } from '@/components/skeletons';

export default function SalesLoading() {
  return <TableSkeleton rows={6} columns={5} />;
}
