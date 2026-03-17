'use client';

import { useState, useEffect } from 'react';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { getQueueStatus, getSyncQueue, clearSyncQueue } from '@/lib/syncQueue';
import { QueueStatus, SyncItem } from '@/lib/syncQueue';
import toast from 'react-hot-toast';
import {
    ClockIcon,
    CheckCircleIcon,
    XCircleIcon,
    ArrowPathIcon,
    XMarkIcon,
    ChevronDownIcon,
    ChevronUpIcon
} from '@heroicons/react/24/outline';

/**
 * Sync Status Panel - Displays offline queue status
 *
 * Shows:
 * - Pending sync count (always visible when > 0)
 * - Detail view with individual items
 * - Manual sync button
 * - Clear queue button
 */
export default function SyncStatusPanel() {
  const { isServerReachable, triggerManualSync } = useServerHealth();
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ total: 0, pending: 0, syncing: 0, failed: 0 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [queueItems, setQueueItems] = useState<SyncItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Update queue status periodically
  useEffect(() => {
    const updateStatus = async () => {
      const status = await getQueueStatus();
      setQueueStatus(status);

      // Load items when expanded
      if (isExpanded) {
        const items = await getSyncQueue();
        setQueueItems(items);
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 2000); // Update every 2s

    return () => clearInterval(interval);
  }, [isExpanded]);

  // Don't render if queue is empty
  if (queueStatus.total === 0) {
    return null;
  }

  const handleManualSync = async () => {
    if (!isServerReachable) {
      toast.error('Нет связи с сервером');
      return;
    }

    setIsSyncing(true);
    try {
      await triggerManualSync();
      // Status will update automatically via useEffect
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearQueue = async () => {
    if (!confirm('Вы уверены, что хотите очистить очередь синхронизации? Несохраненные данные будут потеряны.')) {
      return;
    }

    await clearSyncQueue();
    toast.success('Очередь очищена');
    setIsExpanded(false);
    // Status will update automatically via useEffect
  };

  const formatTimestamp = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}с назад`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}м назад`;
    const hours = Math.floor(minutes / 60);
    return `${hours}ч назад`;
  };

  const getStatusIcon = (item: SyncItem) => {
    switch (item.status) {
      case 'pending':
        return <ClockIcon className="w-4 h-4 text-yellow-500" />;
      case 'syncing':
        return <ArrowPathIcon className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'failed':
        return <XCircleIcon className="w-4 h-4 text-red-500" />;
    }
  };

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
      {/* Header Bar - Always visible when queue has items */}
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClockIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
          <span className="font-semibold text-sm text-yellow-800 dark:text-yellow-200">
            Ожидает синхронизации: {queueStatus.total} {queueStatus.total === 1 ? 'чек' : 'чека'}
          </span>
          {queueStatus.failed > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">
              ({queueStatus.failed} не удалось)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Sync Button */}
          <button
            onClick={handleManualSync}
            disabled={!isServerReachable || isSyncing}
            className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center gap-1"
          >
            {isSyncing ? (
              <>
                <ArrowPathIcon className="w-3 h-3 animate-spin" />
                Синхронизация...
              </>
            ) : (
              <>
                <CheckCircleIcon className="w-3 h-3" />
                Синхронизировать
              </>
            )}
          </button>

          {/* Expand/Collapse Button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-800/50 rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronUpIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            ) : (
              <ChevronDownIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-yellow-200 dark:border-yellow-800 px-4 py-3 max-h-64 overflow-y-auto">
          <div className="space-y-2">
            {queueItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                Очередь пуста
              </p>
            ) : (
              queueItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-2 text-sm"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {getStatusIcon(item)}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {item.type === 'sale' ? 'Чек' : 'Другое'} #{item.id.slice(-8)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                        <span>{formatTimestamp(item.timestamp)}</span>
                        {item.retryCount > 0 && (
                          <span className="text-yellow-600 dark:text-yellow-400">
                            Попытка {item.retryCount}/5
                          </span>
                        )}
                        {item.lastError && (
                          <span className="text-red-500 truncate" title={item.lastError}>
                            {item.lastError}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Clear Queue Button */}
          {queueItems.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleClearQueue}
                className="w-full text-xs px-3 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg font-medium transition-colors flex items-center justify-center gap-1"
              >
                <XCircleIcon className="w-4 h-4" />
                Очистить очередь (удалить все)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
