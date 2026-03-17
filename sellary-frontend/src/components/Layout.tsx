'use client';

import { ReactNode, useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  HomeIcon,
  ShoppingBagIcon,
  CubeIcon,
  ChartBarIcon,
  TruckIcon,
  UserGroupIcon,
  ArrowRightOnRectangleIcon,
  ArrowUturnLeftIcon,
  Bars3Icon,
  XMarkIcon,
  BuildingStorefrontIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '@/lib/store';
import { usePrefetchOnHover } from '@/hooks/useQueries';
import ConnectionStatus from './ui/ConnectionStatus';
import SyncStatusPanel from './SyncStatusPanel';
import { isRestaurantEnabled } from '@/lib/features';

interface LayoutProps {
  children: ReactNode;
}

const navigation = [
  { name: 'Касса', href: '/pos', icon: ShoppingBagIcon, prefetchKey: null },
  { name: 'Ресторан', href: '/restaurant', icon: BuildingStorefrontIcon, prefetchKey: null },
  { name: 'Дашборд', href: '/dashboard', icon: HomeIcon, prefetchKey: 'dashboard' },
  { name: 'История продаж', href: '/sales', icon: ArrowUturnLeftIcon, prefetchKey: 'sales' },
  { name: 'Товары', href: '/products', icon: CubeIcon, prefetchKey: 'products' },
  { name: 'Поставщики', href: '/suppliers', icon: UserGroupIcon, prefetchKey: 'suppliers' },
  { name: 'Закупки', href: '/purchase-orders', icon: TruckIcon, prefetchKey: 'purchaseOrders' },
  { name: 'Отчеты', href: '/reports', icon: ChartBarIcon, prefetchKey: null },
  { name: 'Настройки', href: '/settings', icon: Cog6ToothIcon, prefetchKey: null },
];

export default function Layout({ children }: LayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isAuthenticated } = useAuthStore();
  const prefetch = usePrefetchOnHover();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNavigation = navigation.filter(
    (item) => item.href !== '/restaurant' || isRestaurantEnabled
  );

  const handleNavClick = () => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handlePrefetch = useCallback(
    (prefetchKey: string | null) => {
      if (!prefetchKey) {
        return;
      }

      switch (prefetchKey) {
        case 'dashboard':
          prefetch.prefetchDashboard();
          break;
        case 'products':
          prefetch.prefetchProducts();
          break;
        case 'sales':
          prefetch.prefetchSales();
          break;
        case 'suppliers':
          prefetch.prefetchSuppliers();
          break;
        case 'purchaseOrders':
          prefetch.prefetchPurchaseOrders();
          break;
      }
    },
    [prefetch]
  );

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-lg transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } lg:block`}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-6">
          <Link href="/pos" className="text-xl font-bold text-gray-900 transition-colors hover:text-blue-600">
            Sellary
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 hover:bg-gray-100 lg:hidden"
          >
            <XMarkIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <nav className="mt-6 px-3">
          <div className="space-y-1">
            {visibleNavigation.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/pos' && item.href !== '/dashboard' && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  prefetch={false}
                  onClick={handleNavClick}
                  onMouseEnter={() => handlePrefetch(item.prefetchKey)}
                  className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <item.icon className="mr-3 h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500">
              <span className="text-sm font-medium text-white">{user?.username?.[0]?.toUpperCase()}</span>
            </div>
            <div className="ml-3 min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {user?.full_name || user?.username}
              </p>
              <p className="truncate text-xs capitalize text-gray-500">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <ArrowRightOnRectangleIcon className="mr-3 h-5 w-5" />
            Выйти
          </button>
        </div>
      </div>

      <div className="min-h-screen transition-all duration-300 lg:ml-64">
        <SyncStatusPanel />

        <header className="sticky top-0 z-30 bg-white shadow-sm">
          <div className="flex h-14 items-center justify-between px-4 sm:h-16 sm:px-6">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-md p-2 hover:bg-gray-100 lg:hidden"
            >
              <Bars3Icon className="h-5 w-5 text-gray-500 sm:h-6 sm:w-6" />
            </button>

            <div className="flex items-center space-x-4">
              <ConnectionStatus />
              <span className="text-xs text-gray-600 sm:text-sm">
                {new Date().toLocaleDateString('ru-RU', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            </div>
          </div>
        </header>

        <main className="p-3 pb-20 sm:p-6 sm:pb-6">{children}</main>
      </div>
    </div>
  );
}
