'use client';

import { ChangeEvent, ReactNode, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
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
import { isOfflineModeEnabled, isRestaurantEnabled } from '@/lib/features';

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
  const queryClient = useQueryClient();
  const { user, logout, isAuthenticated, currentCompany, companies, switchCompany } = useAuthStore();
  const prefetch = usePrefetchOnHover();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>(currentCompany?.id ?? '');
  const visibleNavigation = navigation.filter(
    (item) => item.href !== '/restaurant' || isRestaurantEnabled
  );

  useEffect(() => {
    setSelectedCompanyId(currentCompany?.id ?? '');
  }, [currentCompany?.id]);

  // Close sidebar on mobile when navigating
  const handleNavClick = () => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleCompanyChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const companyId = Number(event.target.value);
    if (!companyId || companyId === currentCompany?.id) {
      return;
    }

    setSelectedCompanyId(companyId);
    try {
      await switchCompany(companyId);
      queryClient.clear();
      router.replace('/pos');
      toast.success('Company switched successfully.');
    } catch (error: any) {
      setSelectedCompanyId(currentCompany?.id ?? '');
      toast.error(
        error?.response?.data?.detail || error?.message || 'Could not switch company.',
      );
    }
  };

  const handlePrefetch = useCallback((prefetchKey: string | null) => {
    if (!prefetchKey) return;

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
  }, [prefetch]);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          } lg:block`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <Link href="/pos" className="text-xl font-bold text-gray-900 hover:text-blue-600 transition-colors">
            Sellary
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-md hover:bg-gray-100 lg:hidden"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <nav className="mt-6 px-3">
          <div className="space-y-1">
            {visibleNavigation.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/pos' && item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  prefetch={false}
                  onClick={handleNavClick}
                  onMouseEnter={() => handlePrefetch(item.prefetchKey)}
                  className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-700 hover:bg-gray-100'
                    }`}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Company
            </p>
            <p className="mt-2 truncate text-sm font-semibold text-gray-900">
              {currentCompany?.name || 'No company selected'}
            </p>
            <p className="mt-1 text-xs capitalize text-gray-500">
              {currentCompany?.role || 'No role'}
            </p>
            <select
              value={selectedCompanyId}
              onChange={handleCompanyChange}
              disabled={companies.length <= 1 || isOfflineModeEnabled}
              className="mt-3 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            {isOfflineModeEnabled && companies.length > 1 && (
              <p className="mt-2 text-[11px] leading-4 text-amber-600">
                Multi-company switching is disabled while offline mode is enabled.
              </p>
            )}
          </div>
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {user?.username?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className="ml-3 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.full_name || user?.username}
              </p>
              <p className="text-xs text-gray-500 truncate">{currentCompany?.slug || 'No tenant'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5 mr-3" />
            Выйти
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className={`lg:ml-64 min-h-screen transition-all duration-300`}>
        {/* Sync Status Panel - Shows when queue has items */}
        <SyncStatusPanel />

        {/* Header */}
        <header className="bg-white shadow-sm sticky top-0 z-30">
          <div className="flex items-center justify-between h-14 sm:h-16 px-4 sm:px-6">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-md hover:bg-gray-100 lg:hidden"
            >
              <Bars3Icon className="w-5 h-5 sm:w-6 sm:h-6 text-gray-500" />
            </button>

            <div className="flex items-center space-x-4">
              <ConnectionStatus />
              <div className="hidden sm:block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {currentCompany?.name || 'No company'}
              </div>
              <span className="text-xs sm:text-sm text-gray-600">
                {new Date().toLocaleDateString('ru-RU', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-3 sm:p-6 pb-20 sm:pb-6">{children}</main>
      </div>
    </div>
  );
}
