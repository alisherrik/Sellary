'use client';

import { useState } from 'react';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { CloudArrowDownIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function OfflineGuard({ children }: { children: React.ReactNode }) {
    const { isServerReachable, isChecking } = useServerHealth();
    const [isBannerDismissed, setIsBannerDismissed] = useState(false);

    if (isChecking) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600">Подключение к серверу...</p>
            </div>
        );
    }

    if (!isServerReachable && !isBannerDismissed) {
        return (
            <div className="relative">
                <div className="opacity-70 pointer-events-none">
                    {children}
                </div>
                <div className="fixed top-0 left-0 right-0 z-50 border-b-2 border-amber-400 bg-amber-50 dark:bg-amber-900/30">
                    <div className="px-4 py-2 flex items-center justify-between max-w-7xl mx-auto">
                        <div className="flex items-center gap-2">
                            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                Офлайн — данные могут быть неактуальны
                            </span>
                            <CloudArrowDownIcon className="w-4 h-4 text-amber-500 animate-bounce flex-shrink-0" />
                        </div>
                        <button
                            onClick={() => setIsBannerDismissed(true)}
                            className="p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50 rounded-full transition-colors flex-shrink-0"
                            aria-label="Закрыть"
                        >
                            <XMarkIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!isServerReachable && isBannerDismissed) {
        return <>{children}</>;
    }

    return <>{children}</>;
}
