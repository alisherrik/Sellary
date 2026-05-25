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
    const [prevState, setPrevState] = useState<'checking' | 'online' | 'offline'>('checking');

    const currentState = isChecking ? 'checking' : isServerReachable ? 'online' : 'offline';

    useEffect(() => {
        setPrevState(currentState);
    }, [currentState]);

    useEffect(() => {
        if (!isOfflineModeEnabled) {
            setQueueCount(0);
            return;
        }

        const updateCount = async () => {
            const queue = await getSyncQueue();
            setQueueCount(queue.length);
        };

        updateCount();
        const interval = setInterval(updateCount, 5000);
        return () => clearInterval(interval);
    }, [isServerReachable]);

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

    const isSyncing = queueCount > 0 && !autoSync;

    return (
        <button
            onClick={handleSyncClick}
            disabled={autoSync || queueCount === 0}
            className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all duration-300',
                isChecking && 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 cursor-default',
                !isChecking && !isServerReachable && 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 cursor-default',
                !isChecking && isServerReachable && isSyncing && 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/40',
                !isChecking && isServerReachable && !isSyncing && 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 cursor-default',
            )}
        >
            {isChecking && (
                <>
                    <div className="relative">
                        <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
                        <div className="absolute inset-0 w-2 h-2 rounded-full bg-gray-400 animate-ping opacity-30" />
                    </div>
                    <span className="text-[11px] font-medium text-gray-500">Связь...</span>
                </>
            )}

            {!isChecking && !isServerReachable && (
                <>
                    <SignalSlashIcon className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400">Офлайн</span>
                    {queueCount > 0 && (
                        <span className="ml-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            {queueCount}
                        </span>
                    )}
                </>
            )}

            {!isChecking && isServerReachable && (
                <>
                    <div className="relative">
                        <SignalIcon className={clsx(
                            'w-3.5 h-3.5 transition-colors duration-300',
                            isSyncing ? 'text-orange-500' : 'text-green-500'
                        )} />
                        {isSyncing && (
                            <span className="absolute -inset-1 rounded-full bg-orange-400/20 animate-ping" />
                        )}
                        {!isSyncing && (
                            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                            </span>
                        )}
                    </div>

                    <span className={clsx(
                        'text-[11px] font-bold transition-colors duration-300',
                        isSyncing ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'
                    )}>
                        {isSyncing ? 'Синхр.' : 'Онлайн'}
                    </span>

                    {queueCount > 0 && (
                        <span className={clsx(
                            'flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-bold border transition-colors duration-300',
                            isSyncing
                                ? 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-800'
                                : 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800'
                        )}>
                            {queueCount}
                            {isSyncing && <CloudArrowUpIcon className="w-2.5 h-2.5 ml-0.5 animate-pulse" />}
                        </span>
                    )}
                </>
            )}
        </button>
    );
}
