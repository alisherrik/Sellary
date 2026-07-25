'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import Layout from '@/components/Layout';
import MobileShell from '@/components/mobile/MobileShell';
import { useAuthStore } from '@/lib/store';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, isAuthenticated, hasHydrated, fetchSession } = useAuthStore();
  const isMobile = useMediaQuery('(max-width: 767px)');

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken || !isAuthenticated) {
      router.replace('/login');
      return;
    }

    // Refresh /me so module grants revoked/added by an admin apply without re-login.
    void fetchSession().catch(() => {});
  }, [accessToken, fetchSession, hasHydrated, isAuthenticated, router]);

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        Restoring session...
      </div>
    );
  }

  if (!accessToken || !isAuthenticated) {
    return null;
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
