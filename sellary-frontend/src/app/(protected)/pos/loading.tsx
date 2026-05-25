export default function PosLoading() {
  return (
    <div className="h-full animate-pulse p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 h-5 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-700/50" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 h-5 w-24 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-3">
            <div className="h-4 w-full rounded bg-gray-100 dark:bg-gray-700/50" />
            <div className="h-4 w-2/3 rounded bg-gray-100 dark:bg-gray-700/50" />
            <div className="mt-4 h-12 rounded-xl bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    </div>
  );
}
