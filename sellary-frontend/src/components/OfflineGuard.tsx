'use client';

import { useServerHealth } from '@/providers/ServerHealthProvider';
import { CloudArrowDownIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export default function OfflineGuard({ children }: { children: React.ReactNode }) {
    const { isServerReachable, isChecking } = useServerHealth();

    // Show loading while checking server health
    if (isChecking) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600">Подключение к серверу...</p>
            </div>
        );
    }

    // Show children when server is reachable
    if (isServerReachable) {
        return <>{children}</>;
    }

    // Show offline message when server is unreachable
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="bg-orange-50 p-6 rounded-full mb-6 relative">
                <ExclamationTriangleIcon className="w-12 h-12 text-orange-500" />
                <div className="absolute top-0 right-0 w-4 h-4 bg-red-500 border-2 border-white rounded-full animate-ping" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Офлайн режим</h2>
            <p className="text-gray-500 max-w-md mx-auto mb-8 leading-relaxed">
                Информация на этой странице требует сверки с сервером.
                <br />
                Для избежания ошибок отображение временно отключено.
            </p>
            <div className="flex items-center gap-3 text-sm font-semibold text-orange-700 bg-orange-50 px-5 py-3 rounded-xl border border-orange-100">
                <CloudArrowDownIcon className="w-5 h-5 animate-bounce" />
                Ожидание сервера...
            </div>
        </div>
    );
}
