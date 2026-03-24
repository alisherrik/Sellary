'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import Layout from '@/components/Layout';
import { useAuthStore } from '@/lib/store';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { accessToken, isAuthenticated, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken || !isAuthenticated) {
      router.replace('/login');
    }
  }, [accessToken, hasHydrated, isAuthenticated, router]);

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

  return <Layout>{children}</Layout>;
}
