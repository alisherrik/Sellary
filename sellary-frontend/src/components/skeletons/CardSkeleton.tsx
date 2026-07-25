export default function CardSkeleton() {
    return (
        <div className="animate-pulse border-2 border-[var(--erp-divider)] bg-white p-4">
            <div className="flex items-center">
                <div className="h-12 w-12 bg-[var(--erp-surface)]"></div>
                <div className="ml-4 flex-1">
                    <div className="mb-2 h-3 w-1/3 bg-[var(--erp-surface)]"></div>
                    <div className="h-6 w-2/3 bg-[var(--erp-surface)]"></div>
                </div>
            </div>
        </div>
    );
}

// Matches the real stat grid (grid-cols-2 lg:grid-cols-4) so the page does not
// reflow columns the moment data lands.
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
                <CardSkeleton key={i} />
            ))}
        </div>
    );
}
