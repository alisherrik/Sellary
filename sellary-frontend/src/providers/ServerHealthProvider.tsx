'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface ServerHealthContextValue {
  isServerReachable: boolean;
  isNavigatorOnline: boolean;
  isChecking: boolean;
  lastCheckedAt: Date | null;
}

const ServerHealthContext = createContext<ServerHealthContextValue>({
  isServerReachable: true,
  isNavigatorOnline: true,
  isChecking: false,
  lastCheckedAt: null,
});

export function useServerHealth() {
  return useContext(ServerHealthContext);
}

type ApiClient = { post: (path: string) => Promise<unknown> };

const POLL_INTERVAL_MS = 30_000;

export function ServerHealthProvider({
  children,
  apiClient,
}: {
  children: React.ReactNode;
  apiClient?: ApiClient;
}) {
  const [isServerReachable, setIsServerReachable] = useState(true);
  const [isNavigatorOnline, setIsNavigatorOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    if (!navigator.onLine) {
      setIsServerReachable(false);
      setIsChecking(false);
      return;
    }
    setIsChecking(true);
    try {
      const response = await (apiClient?.post?.('/health') ?? fetch('/health', { method: 'POST' }));
      if (
        response &&
        typeof response === 'object' &&
        'ok' in response &&
        !(response as Response).ok
      ) {
        throw new Error(`Server returned ${(response as Response).status}`);
      }
      setIsServerReachable(true);
    } catch {
      setIsServerReachable(false);
    } finally {
      setIsChecking(false);
      setLastCheckedAt(new Date());
    }
  }, [apiClient]);

  useEffect(() => {
    const handleOnline = () => {
      setIsNavigatorOnline(true);
      checkHealth();
    };
    const handleOffline = () => {
      setIsNavigatorOnline(false);
      setIsServerReachable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    checkHealth();
    intervalRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkHealth]);

  return (
    <ServerHealthContext.Provider
      value={{ isServerReachable, isNavigatorOnline, isChecking, lastCheckedAt }}
    >
      {children}
    </ServerHealthContext.Provider>
  );
}
