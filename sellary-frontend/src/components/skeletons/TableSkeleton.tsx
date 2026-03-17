export default function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
    return (
        <>
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <tr key={rowIndex} className="animate-pulse">
                    {Array.from({ length: columns }).map((_, colIndex) => (
                        <td key={colIndex} className="px-4 py-3">
                            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}
