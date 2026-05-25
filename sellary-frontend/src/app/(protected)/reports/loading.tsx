import { StatCardsSkeleton, ChartSkeleton, CardSkeleton } from '@/components/skeletons';

export default function ReportsLoading() {
  return (
    <div className="space-y-4 p-4">
      <StatCardsSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr,1fr]">
        <ChartSkeleton />
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}
