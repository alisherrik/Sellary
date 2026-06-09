interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export default function TableSkeleton({
  rows = 5,
  columns = 6,
}: TableSkeletonProps) {
  return (
    <div className="space-y-3" role="status" aria-label="Загрузка таблицы">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid animate-pulse gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-800/60"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={colIndex}
              className="h-4 rounded bg-gray-200 dark:bg-gray-700"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
