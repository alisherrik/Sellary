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
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isRestaurantEnabled) {
      router.replace('/pos');
      return;
    }

    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated || !isRestaurantEnabled) {
    return null;
  }

  // Use the main Layout component to show navigation on all devices
  return <>{children}</>;
}
