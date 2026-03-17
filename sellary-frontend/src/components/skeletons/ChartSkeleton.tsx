export default function ChartSkeleton({ height = 300 }: { height?: number }) {
    return (
        <div className="card animate-pulse">
            <div className="card-header">
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            </div>
            <div className="card-body">
                <div
                    className="bg-gray-100 dark:bg-gray-800 rounded flex items-end justify-around px-4 pb-4"
                    style={{ height }}
                >
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div
                            key={i}
                            className="bg-gray-200 dark:bg-gray-700 rounded-t w-8"
                            style={{ height: `${30 + Math.random() * 60}%` }}
                        ></div>
                    ))}
                </div>
            </div>
        </div>
    );
}
