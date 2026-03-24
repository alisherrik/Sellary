'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useOwnerStore } from '@/lib/owner-store';

export default function OwnerProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { accessToken, isAuthenticated, fetchSession, hasHydrated } = useOwnerStore();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (accessToken && !isAuthenticated) {
      void fetchSession();
    }
  }, [accessToken, fetchSession, hasHydrated, isAuthenticated]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken && !isAuthenticated) {
      router.replace('/owner/login');
    }
  }, [accessToken, hasHydrated, isAuthenticated, router]);

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        Restoring owner session...
      </div>
    );
  }

  if (!accessToken && !isAuthenticated) {
    return null;
  }

  if (accessToken && !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        Loading owner session...
      </div>
    );
  }

  return <>{children}</>;
}
