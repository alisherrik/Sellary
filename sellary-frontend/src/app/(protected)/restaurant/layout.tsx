'use client';

import { redirect } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { useEffect } from 'react';


export default function RestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      redirect('/login');
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return null;
  }

  // Use the main Layout component to show navigation on all devices
  return <>{children}</>;
}
