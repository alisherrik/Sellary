'use client';

import { useState, useEffect } from 'react';
import { WifiIcon, SignalIcon, SignalSlashIcon } from '@heroicons/react/24/outline';

export default function NetworkStatus() {
    const [isOnline, setIsOnline] = useState(true);
    const [latency, setLatency] = useState<number | null>(null);

    const checkLatency = async () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setIsOnline(false);
            setLatency(null);
            return;
        }

        const start = Date.now();
        try {
            // Use a lightweight resource to check ping/latency
            await fetch('/icon.svg', { method: 'HEAD', cache: 'no-store' });
            const end = Date.now();
            setLatency(end - start);
            setIsOnline(true);
        } catch (e) {
            // Fetch checks connectivity better than navigator.onLine
        }
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;

        setIsOnline(navigator.onLine);
        checkLatency();

        const handleOnline = () => {
            setIsOnline(true);
            checkLatency();
        };

        const handleOffline = () => {
            setIsOnline(false);
            setLatency(null);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const interval = setInterval(checkLatency, 5000); // Check latency every 5 seconds

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, []);

    if (typeof window === 'undefined') return null; // Hydration fix

    const getStatusColor = () => {
        if (!isOnline) return 'bg-red-50 text-red-600 border-red-100';
        if (!latency) return 'bg-gray-50 text-gray-600 border-gray-100';
        if (latency < 200) return 'bg-green-50 text-green-600 border-green-100';
        if (latency < 500) return 'bg-yellow-50 text-yellow-600 border-yellow-100';
        return 'bg-orange-50 text-orange-600 border-orange-100';
    };

    const getStatusText = () => {
        if (!isOnline) return 'Не в сети';
        if (latency === null) return 'В сети';
        return `${latency}ms`;
    };

    const Icon = !isOnline ? SignalSlashIcon : (latency && latency > 300 ? SignalIcon : WifiIcon);

    return (
        <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold transition-all duration-300 ${getStatusColor()}`}
            title={isOnline ? `В сети (задержка: ${latency} мс)` : 'Режим офлайн активен'}
        >
            <Icon className="w-3.5 h-3.5" />
            <span>{getStatusText()}</span>
        </div>
    );
}
