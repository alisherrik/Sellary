interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export default function TableSkeleton({
  rows = 5,
  columns = 6,
}: TableSkeletonProps) {
  return (
    <div className="space-y-2" role="status" aria-label="Загрузка таблицы">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid animate-pulse gap-3 border border-[var(--erp-divider)] bg-white p-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div key={colIndex} className="h-4 bg-[var(--erp-surface)]" />
          ))}
        </div>
      ))}
    </div>
  );
}
