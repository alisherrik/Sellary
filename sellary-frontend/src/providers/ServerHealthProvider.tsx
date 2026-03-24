'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { processQueue, getSyncConfig, setSyncConfig } from '@/lib/syncQueue';
import toast from 'react-hot-toast';
import { isOfflineModeEnabled } from '@/lib/features';

// ZERO TRUST: Health check URL
// MUST be POST to bypass Service Worker cache
// MUST use direct backend URL to match API configuration
const HEALTH_CHECK_BASE_URL = (
    process.env.NEXT_PUBLIC_API_PROXY_TARGET || 'http://127.0.0.1:8000'
).replace(/\/$/, '');
const HEALTH_CHECK_TIMEOUT = 3000; // 3 seconds - NON-NEGOTIABLE

interface ServerHealthContextType {
    isServerReachable: boolean;
    isNavigatorOnline: boolean;
    isChecking: boolean;
    autoSync: boolean;
    checkHealth: () => Promise<void>;
    toggleAutoSync: () => Promise<void>;
    triggerManualSync: () => Promise<void>;
}

const ServerHealthContext = createContext<ServerHealthContextType>({
    isServerReachable: false,
    isNavigatorOnline: true,
    isChecking: true,
    autoSync: true,
    checkHealth: async () => { },
    toggleAutoSync: async () => { },
    triggerManualSync: async () => { },
});

export const useServerHealth = () => useContext(ServerHealthContext);

export function ServerHealthProvider({ children }: { children: React.ReactNode }) {
    const [isNavigatorOnline, setIsNavigatorOnline] = useState(true);
    const [isServerReachable, setIsServerReachable] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [autoSync, setAutoSync] = useState(isOfflineModeEnabled);
    const previousServerReachable = useRef(false);

    // Load initial sync config
    useEffect(() => {
        if (!isOfflineModeEnabled) {
            setAutoSync(false);
            return;
        }

        getSyncConfig().then(config => setAutoSync(config.autoSync));
    }, []);

    const toggleAutoSync = async () => {
        if (!isOfflineModeEnabled) {
            return;
        }

        const newValue = !autoSync;
        setAutoSync(newValue);

        // Get current config and update it
        const currentConfig = await getSyncConfig();
        await setSyncConfig({ ...currentConfig, autoSync: newValue });

        toast.success(newValue ? 'Авто-синхронизация включена' : 'Авто-синхронизация отключена');

        // If turned ON and server is reachable, try syncing immediately
        if (newValue && isServerReachable) {
            triggerManualSync();
        }
    };

    const triggerManualSync = async () => {
        if (!isOfflineModeEnabled) {
            toast("Offline sync MVP versiyada o'chiq", { icon: 'i' });
            return;
        }
        if (!isServerReachable) {
            toast.error('Нет связи с сервером');
            return;
        }

        const toastId = toast.loading('Синхронизация...');
        try {
            const { processed, failed } = await processQueue(true); // Force sync
            if (processed > 0) {
                toast.success(`Синхронизировано: ${processed} чеков`, { id: toastId });
            } else if (failed > 0) {
                toast.error(`Ошибка синхронизации: ${failed}`, { id: toastId });
            } else {
                toast.success('Все данные синхронизированы', { id: toastId });
            }
        } catch (error) {
            toast.error('Ошибка при синхронизации', { id: toastId });
        }
    };

    const checkHealth = useCallback(async () => {
        // ZERO TRUST MODEL:
        // - navigator.onLine is UNTRUSTED (tracked for info only)
        // - ONLY POST /api/health response determines connectivity
        // - Timeout > 3s = OFFLINE
        // - Any error = OFFLINE
        // - ONLY HTTP 200 OK = ONLINE

        // Track browser state separately (informational only)
        if (typeof navigator !== 'undefined') {
            setIsNavigatorOnline(navigator.onLine);
        }

        // ALWAYS check server health, regardless of browser online status
        try {
            // CRITICAL: 3-second timeout (NON-NEGOTIABLE per architecture)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

            const response = await fetch(`${HEALTH_CHECK_BASE_URL}/health`, {
                method: 'POST', // POST bypasses SW cache
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ping: true })
            });

            clearTimeout(timeoutId);

            // ZERO TRUST: ONLY HTTP 200 OK = ONLINE
            // - 200 OK → Server is ONLINE
            // - Anything else (4xx, 5xx) → OFFLINE
            // - This prevents false positives from cached 401s
            if (response.status === 200) {
                setIsServerReachable(true);
            } else {
                console.warn(`Server health check returned non-200 status: ${response.status}`);
                setIsServerReachable(false);
            }

        } catch (error) {
            console.warn('Server heartbeat failed (Network Error):', error);
            setIsServerReachable(false);
        } finally {
            setIsChecking(false);
        }
    }, []);

    useEffect(() => {
        // Initial check
        checkHealth();

        // Listeners for network changes
        // IMPORTANT: We don't immediately set offline/online based on browser state
        // Instead, we re-check server health when browser state changes
        // This ensures server health is ALWAYS the source of truth
        const handleOnline = () => {
            setIsNavigatorOnline(true);
            checkHealth(); // Verify server is actually reachable
        };
        const handleOffline = () => {
            setIsNavigatorOnline(false);
            checkHealth(); // Check if server is still reachable (e.g., localhost)
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Periodic heartbeat (every 30s)
        const interval = setInterval(checkHealth, 30000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, [checkHealth]);

    // CRITICAL: Auto-process sync queue when server comes back online
    useEffect(() => {
        if (!isOfflineModeEnabled) {
            previousServerReachable.current = isServerReachable;
            return;
        }

        // Only trigger on transition from false to true
        if (isServerReachable && !previousServerReachable.current && !isChecking) {
            console.log('Server is back online!');

            // Only sync automatically if enabled
            if (autoSync) {
                console.log('Auto-syncing...');
                processQueue()
                    .then(({ processed, failed, skipped }) => {
                        if (skipped) return;

                        if (processed > 0) {
                            toast.success(`Синхронизировано: ${processed} чеков`, { icon: '✅' });
                        }
                        if (failed > 0) {
                            toast.error(`Не синхронизировано: ${failed} чеков`, { icon: '⚠️' });
                        }
                    })
                    .catch((error) => {
                        console.error('Failed to process sync queue:', error);
                    });
            } else {
                console.log('Auto-sync disabled. Queue pending.');
                toast('Сервер доступен. Синхронизируйте данные вручную.', { icon: 'ℹ️' });
            }
        }

        // Update previous state for next comparison
        previousServerReachable.current = isServerReachable;
    }, [isServerReachable, isChecking, autoSync]);

    return (
        <ServerHealthContext.Provider value={{
            isServerReachable,
            isNavigatorOnline,
            isChecking,
            autoSync,
            checkHealth,
            toggleAutoSync,
            triggerManualSync
        }}>
            {children}
        </ServerHealthContext.Provider>
    );
}
