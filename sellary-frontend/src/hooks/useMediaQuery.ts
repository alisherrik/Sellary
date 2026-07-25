'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Matches a media query. The server snapshot is always `false`, so SSR and the
 * hydration render agree; the real value lands in the same synchronous batch
 * as the rest of hydration rather than a frame later — which matters because
 * the protected layout swaps whole shells on this value, and a late swap
 * unmounts every page's state.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
