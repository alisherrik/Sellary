'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';

import { isOfflineModeEnabled } from '@/lib/features';
import { isStorageAvailable, getStorageErrorMessage } from '@/lib/storage';
import { getSyncConfig, processQueue, setSyncConfig } from '@/lib/syncQueue';
import { onSWUpdate, registerSW } from '@/lib/sw';

const HEALTH_CHECK_TIMEOUT = 3000;

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
  checkHealth: async () => {},
  toggleAutoSync: async () => {},
  triggerManualSync: async () => {},
});

export const useServerHealth = () => useContext(ServerHealthContext);

export function ServerHealthProvider({ children }: { children: React.ReactNode }) {
  const [isNavigatorOnline, setIsNavigatorOnline] = useState(true);
  const [isServerReachable, setIsServerReachable] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [autoSync, setAutoSync] = useState(isOfflineModeEnabled);
  const previousServerReachable = useRef(false);

  useEffect(() => {
    if (!isOfflineModeEnabled) {
      setAutoSync(false);
      return;
    }

    getSyncConfig().then((config) => setAutoSync(config.autoSync));
  }, []);

  const triggerManualSync = useCallback(async () => {
    if (!isOfflineModeEnabled) {
      toast('Офлайн-синхронизация отключена в MVP', { icon: 'i' });
      return;
    }

    if (!isServerReachable) {
      toast.error('Нет связи с сервером');
      return;
    }

    const storageAvailable = await isStorageAvailable();
    if (!storageAvailable) {
      toast.error(getStorageErrorMessage());
      return;
    }

    const toastId = toast.loading('Синхронизация...');
    try {
      const { processed, failed } = await processQueue(true);
      if (processed > 0) {
        toast.success(`Синхронизировано: ${processed} чеков`, { id: toastId });
      } else if (failed > 0) {
        toast.error(`Ошибка синхронизации: ${failed}`, { id: toastId });
      } else {
        toast.success('Все данные синхронизированы', { id: toastId });
      }
    } catch {
      toast.error('Ошибка при синхронизации', { id: toastId });
    }
  }, [isServerReachable]);

  const toggleAutoSync = useCallback(async () => {
    if (!isOfflineModeEnabled) {
      return;
    }

    const newValue = !autoSync;
    setAutoSync(newValue);

    const currentConfig = await getSyncConfig();
    await setSyncConfig({ ...currentConfig, autoSync: newValue });

    toast.success(newValue ? 'Авто-синхронизация включена' : 'Авто-синхронизация отключена');

    if (newValue && isServerReachable) {
      void triggerManualSync();
    }
  }, [autoSync, isServerReachable, triggerManualSync]);

  const checkHealth = useCallback(async () => {
    if (typeof navigator !== 'undefined') {
      setIsNavigatorOnline(navigator.onLine);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

      const response = await fetch(`/health`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ping: true }),
      });

      clearTimeout(timeoutId);
      setIsServerReachable(response.status === 200);

      if (response.status !== 200) {
        console.warn(`Server health check returned non-200 status: ${response.status}`);
      }
    } catch (error) {
      console.warn('Server heartbeat failed (Network Error):', error);
      setIsServerReachable(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();

    const handleOnline = () => {
      setIsNavigatorOnline(true);
      void checkHealth();
    };
    const handleOffline = () => {
      setIsNavigatorOnline(false);
      void checkHealth();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(() => {
      void checkHealth();
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [checkHealth]);

  useEffect(() => {
    if (!isOfflineModeEnabled) {
      previousServerReachable.current = isServerReachable;
      return;
    }

    if (isServerReachable && !previousServerReachable.current && !isChecking) {
      if (autoSync) {
        isStorageAvailable().then((available) => {
          if (!available) {
            toast.error(getStorageErrorMessage());
            return;
          }

          processQueue()
            .then(({ processed, failed, skipped }) => {
              if (skipped) {
                return;
              }

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
        });
      } else {
        toast('Сервер доступен. Синхронизируйте данные вручную.', { icon: 'ℹ️' });
      }
    }

    previousServerReachable.current = isServerReachable;
  }, [autoSync, isChecking, isServerReachable]);

  useEffect(() => {
    if (!isOfflineModeEnabled) {
      return;
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      toast.error(detail?.message || 'Ошибка очереди синхронизации');
    };

    window.addEventListener('sync-queue-warning', handler);
    return () => window.removeEventListener('sync-queue-warning', handler);
  }, []);

  useEffect(() => {
    if (!isOfflineModeEnabled) {
      return;
    }

    registerSW();

    onSWUpdate(() => {
      toast('Новая версия доступна. Обновите страницу.', {
        duration: 0,
        icon: '🔄',
        style: { cursor: 'pointer' },
      });
    });
  }, []);

  return (
    <ServerHealthContext.Provider
      value={{
        isServerReachable,
        isNavigatorOnline,
        isChecking,
        autoSync,
        checkHealth,
        toggleAutoSync,
        triggerManualSync,
      }}
    >
      {children}
    </ServerHealthContext.Provider>
  );
}
