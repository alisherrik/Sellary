'use client';

import { useServerHealth } from '@/providers/ServerHealthProvider';
import { CloudArrowUpIcon, SignalIcon, SignalSlashIcon } from '@heroicons/react/24/outline';
import { useState, useEffect } from 'react';
import { getSyncQueue } from '@/lib/syncQueue';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { isOfflineModeEnabled } from '@/lib/features';

export default function ConnectionStatus() {
    const { isServerReachable, isChecking, triggerManualSync, autoSync } = useServerHealth();
    const [queueCount, setQueueCount] = useState(0);

    // Poll queue count
    useEffect(() => {
        if (!isOfflineModeEnabled) {
            setQueueCount(0);
            return;
        }

        const updateCount = async () => {
            const queue = await getSyncQueue();
            const count = queue.length;
            setQueueCount(count);
        };

        updateCount();
        const interval = setInterval(updateCount, 5000);
        return () => clearInterval(interval);
    }, [isServerReachable]); // Update when status changes too

    const handleSyncClick = () => {
        if (!isOfflineModeEnabled) {
            return;
        }

        if (!autoSync && queueCount > 0 && isServerReachable) {
            triggerManualSync();
        } else if (queueCount > 0 && !isServerReachable) {
            toast.error('Ожидание подключения к серверу...');
        }
    };

    if (isChecking) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
                <span className="text-xs font-medium text-gray-500">Связь...</span>
            </div>
        );
    }

    if (!isServerReachable) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                <SignalSlashIcon className="w-4 h-4 text-red-500" />
                <span className="text-xs font-bold text-red-600 dark:text-red-400">Офлайн</span>
                {queueCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-[10px] border border-red-200 dark:border-red-800">
                        {queueCount}
                    </span>
                )}
            </div>
        );
    }

    // Online State
    return (
        <button
            onClick={handleSyncClick}
            disabled={autoSync || queueCount === 0}
            className={clsx(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200",
                queueCount > 0 && !autoSync
                    ? "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50 cursor-pointer hover:bg-orange-100"
                    : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 cursor-default"
            )}
        >
            <div className="relative">
                <SignalIcon className={clsx(
                    "w-4 h-4",
                    queueCount > 0 && !autoSync ? "text-orange-500" : "text-green-500"
                )} />
                {queueCount === 0 && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                )}
            </div>

            <span className={clsx(
                "text-xs font-bold",
                queueCount > 0 && !autoSync ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"
            )}>
                {queueCount > 0 && !autoSync ? 'Синхронизация' : 'Онлайн'}
            </span>

            {queueCount > 0 && (
                <span className={clsx(
                    "ml-1 flex items-center justify-center min-w-[18px] h-4.5 px-1 rounded-md text-[10px] border font-bold",
                    !autoSync
                        ? "bg-orange-100 text-orange-700 border-orange-200"
                        : "bg-green-100 text-green-700 border-green-200"
                )}>
                    {queueCount}
                    {!autoSync && <CloudArrowUpIcon className="w-3 h-3 ml-1" />}
                </span>
            )}
        </button>
    );
}
