export default function CardSkeleton() {
    return (
        <div className="card animate-pulse">
            <div className="card-body">
                <div className="flex items-center">
                    <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
                    <div className="ml-4 flex-1">
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
                        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: count }).map((_, i) => (
                <CardSkeleton key={i} />
            ))}
        </div>
    );
}
