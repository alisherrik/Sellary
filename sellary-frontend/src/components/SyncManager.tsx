'use client';
import { useEffect } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';

export default function SyncManager() {
    const { processQueue, checkQueueLength } = useOfflineSync();

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // Initial check
        checkQueueLength();

        const handleOnline = () => processQueue(false);
        window.addEventListener('online', handleOnline);

        // Auto-sync interval (every 15s)
        const interval = setInterval(() => processQueue(false), 15000);

        return () => {
            window.removeEventListener('online', handleOnline);
            clearInterval(interval);
        };
    }, [processQueue, checkQueueLength]);

    return null;
}
