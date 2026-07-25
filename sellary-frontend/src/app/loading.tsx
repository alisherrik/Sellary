import LoadingSpinner from '@/components/LoadingSpinner';

export default function Loading() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-[var(--erp-bg)]">
            <LoadingSpinner size={80} />
        </div>
    );
}
