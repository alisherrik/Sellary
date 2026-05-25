import { StatCardsSkeleton, CardSkeleton } from '@/components/skeletons';

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <StatCardsSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
