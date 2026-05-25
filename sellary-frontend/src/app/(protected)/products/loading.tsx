import { TableSkeleton } from '@/components/skeletons';

export default function ProductsLoading() {
  return <TableSkeleton rows={6} columns={5} />;
}
