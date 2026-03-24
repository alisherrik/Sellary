'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { useEffect } from 'react';
import { isRestaurantEnabled } from '@/lib/features';


export default function RestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!isRestaurantEnabled) {
      router.replace('/pos');
      return;
    }

    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [hasHydrated, isAuthenticated, router]);

  if (!hasHydrated) {
    return null;
  }

  if (!isAuthenticated || !isRestaurantEnabled) {
    return null;
  }

  // Use the main Layout component to show navigation on all devices
  return <>{children}</>;
}
