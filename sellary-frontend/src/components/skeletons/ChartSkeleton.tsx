// Fixed heights, not Math.random(): a random bar height renders differently on
// the server and the client and produces a hydration mismatch on every load.
const BAR_HEIGHTS = [45, 72, 38, 61, 84, 52, 67];

export default function ChartSkeleton({ height = 300 }: { height?: number }) {
    return (
        <div className="animate-pulse border-2 border-[var(--erp-divider)] bg-white">
            <div className="border-b border-[var(--erp-divider)] px-4 py-3">
                <div className="h-5 w-1/4 bg-[var(--erp-surface)]"></div>
            </div>
            <div className="p-4">
                <div
                    className="flex items-end justify-around bg-[var(--erp-bg)] px-4 pb-4"
                    style={{ height }}
                >
                    {BAR_HEIGHTS.map((barHeight, i) => (
                        <div
                            key={i}
                            className="w-8 bg-[var(--erp-surface)]"
                            style={{ height: `${barHeight}%` }}
                        ></div>
                    ))}
                </div>
            </div>
        </div>
    );
}
