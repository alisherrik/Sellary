'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import Layout from '@/components/Layout';
import MobileShell from '@/components/mobile/MobileShell';
import SessionSplash from '@/components/SessionSplash';
import { useAuthStore } from '@/lib/store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { MOBILE_QUERY } from '@/lib/breakpoints';

// How long a tab may sit idle before its session is slid forward on return.
// Short enough that a token never ages out under an open tab, long enough that
// tabbing back and forth does not talk to the server every time.
const REFRESH_AFTER_MS = 30 * 60 * 1000;

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Per-field selectors: destructuring the whole store re-renders the shell
  // and every page under it on any auth write (fetchSession alone writes six
  // keys on mount).
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const fetchSession = useAuthStore((state) => state.fetchSession);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // The app is not rendered until the stored token has been checked against the
  // server. Without this the user saw their dashboard and was then thrown to
  // /login a moment later, when the /me call came back 401.
  const [sessionChecked, setSessionChecked] = useState(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken || !isAuthenticated) {
      router.replace('/login');
      return;
    }

    // Refresh /me so module grants revoked/added by an admin apply without re-login.
    // A network failure is not a session failure: render anyway and let the
    // pages show their own offline state. A 401 never lands here — the
    // interceptor tries the sliding refresh and, failing that, redirects.
    void fetchSession()
      .catch(() => {})
      .finally(() => setSessionChecked(true));
  }, [accessToken, fetchSession, hasHydrated, isAuthenticated, router]);

  // Slide the session forward when the operator comes back to the tab, so a
  // register left open overnight is still signed in at opening time.
  useEffect(() => {
    if (!sessionChecked) {
      return;
    }
    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const now = Date.now();
      if (now - lastRefreshRef.current < REFRESH_AFTER_MS) {
        return;
      }
      lastRefreshRef.current = now;
      void refreshSession();
    };

    maybeRefresh();
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('focus', maybeRefresh);
    };
  }, [refreshSession, sessionChecked]);

  if (!hasHydrated) {
    return <SessionSplash label="Восстановление сессии" />;
  }

  if (!accessToken || !isAuthenticated) {
    return <SessionSplash label="Переход ко входу" />;
  }

  if (!sessionChecked) {
    return <SessionSplash label="Проверка сессии" />;
  }

  // POS brings its own fullscreen chrome on every viewport (see pos/page.tsx).
  // The desktop Layout already steps aside for it; on mobile the shell was
  // still wrapping it, and the POS cart bar (fixed, z-30) painted over the tab
  // bar while the shell's own top bar hid POS's shift pill and its only exit —
  // leaving the cashier with no way out of the register.
  if (pathname.startsWith('/pos')) {
    return <>{children}</>;
  }

  if (isMobile) {
    return <MobileShell>{children}</MobileShell>;
  }

  return <Layout>{children}</Layout>;
}
