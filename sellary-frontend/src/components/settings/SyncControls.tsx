'use client';

import { useState, useEffect } from 'react';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { getSyncQueue } from '@/lib/syncQueue';
import { CloudArrowUpIcon, ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Switch } from '@headlessui/react';
import clsx from 'clsx';

export default function SyncControls() {
    const { isServerReachable, autoSync, toggleAutoSync, triggerManualSync, isChecking } = useServerHealth();
    const [queueCount, setQueueCount] = useState(0);

    // Poll queue count
    useEffect(() => {
        const updateCount = async () => {
            const queue = await getSyncQueue();
            setQueueCount(queue.length);
        };

        updateCount();
        const interval = setInterval(updateCount, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <CloudArrowUpIcon className="w-6 h-6 text-blue-500" />
                Синхронизация данных
            </h3>

            <div className="space-y-6">
                {/* Connection Status */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Статус сервера</span>
                    <div className="flex items-center gap-2">
                        {isChecking ? (
                            <span className="flex items-center gap-2 text-gray-500 text-sm">
                                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                Проверка...
                            </span>
                        ) : isServerReachable ? (
                            <span className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-bold">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                Онлайн
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm font-bold">
                                <ExclamationTriangleIcon className="w-4 h-4" />
                                Офлайн
                            </span>
                        )}
                    </div>
                </div>

                {/* Queue Status */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Очередь выгрузки</span>
                    <span className={clsx(
                        "text-sm font-bold px-3 py-1 rounded-lg",
                        queueCount > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
                    )}>
                        {queueCount} элементов
                    </span>
                </div>

                {/* Auto Sync Toggle */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Авто-синхронизация</p>
                        <p className="text-xs text-gray-500 mt-1">
                            Автоматически отправлять данные при появлении сети
                        </p>
                    </div>
                    <Switch
                        checked={autoSync}
                        onChange={toggleAutoSync}
                        className={clsx(
                            autoSync ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600',
                            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2'
                        )}
                    >
                        <span
                            aria-hidden="true"
                            className={clsx(
                                autoSync ? 'translate-x-5' : 'translate-x-0',
                                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                            )}
                        />
                    </Switch>
                </div>

                {/* Manual Sync Button */}
                <div className="pt-2">
                    <button
                        onClick={triggerManualSync}
                        disabled={!isServerReachable || queueCount === 0}
                        className="w-full h-11 flex items-center justify-center gap-2 bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold transition-all"
                    >
                        <ArrowPathIcon className="w-5 h-5" />
                        Синхронизировать сейчас
                    </button>
                    {!autoSync && queueCount > 0 && isServerReachable && (
                        <p className="text-center text-xs text-orange-600 mt-2 font-medium">
                            Доступны данные для отправки. Нажмите кнопку выше.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
