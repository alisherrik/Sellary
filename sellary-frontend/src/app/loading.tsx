import LoadingSpinner from '@/components/LoadingSpinner';

export default function Loading() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
            <LoadingSpinner size={80} />
        </div>
    );
}
