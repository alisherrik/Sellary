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
  Cog6ToothIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore, useUIStore } from '@/lib/store';
import { usePrefetchOnHover } from '@/hooks/useQueries';
import { ConnectionStatus } from './ui/ConnectionStatus';

interface LayoutProps {
  children: ReactNode;
}

const navigation = [
  { name: 'Касса', href: '/pos', icon: ShoppingBagIcon, prefetchKey: null },
  { name: 'Дашборд', href: '/dashboard', icon: HomeIcon, prefetchKey: 'dashboard' },
  { name: 'История продаж', href: '/sales', icon: ArrowUturnLeftIcon, prefetchKey: 'sales' },
  { name: 'Товары', href: '/products', icon: CubeIcon, prefetchKey: 'products' },
  { name: 'Клиенты', href: '/customers', icon: UserGroupIcon, prefetchKey: 'customers' },
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
  const { sidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>(currentCompany?.id ?? '');
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
      toast.success('Компания успешно переключена.');
    } catch (error: any) {
      setSelectedCompanyId(currentCompany?.id ?? '');
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось переключить компанию.',
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
        case 'customers':
          prefetch.prefetchCustomers();
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
        className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-lg transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'} lg:block`}
      >
        <div
          className={`flex h-16 items-center border-b border-gray-200 px-4 ${
            sidebarCollapsed ? 'lg:justify-center lg:px-2' : 'justify-between lg:px-6'
          }`}
        >
          <Link
            href="/pos"
            prefetch={false}
            className={`text-xl font-bold text-gray-900 transition-colors hover:text-blue-600 ${
              sidebarCollapsed ? 'lg:hidden' : ''
            }`}
          >
            Sellary
          </Link>
          {/* Desktop collapse / expand toggle */}
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            className="hidden rounded-md p-1.5 text-gray-500 hover:bg-gray-100 lg:block"
          >
            {sidebarCollapsed ? (
              <ChevronDoubleRightIcon className="h-5 w-5" />
            ) : (
              <ChevronDoubleLeftIcon className="h-5 w-5" />
            )}
          </button>
          {/* Mobile close */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 hover:bg-gray-100 lg:hidden"
          >
            <XMarkIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <nav className="mt-6 px-3">
          <div className="space-y-1">
            {navigation.map((item) => {
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
                  title={sidebarCollapsed ? item.name : undefined}
                  className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-100'
                  } ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''}`}
                >
                  <item.icon className={`h-5 w-5 shrink-0 ${sidebarCollapsed ? 'mr-3 lg:mr-0' : 'mr-3'}`} />
                  <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className={`absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-4 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
          <div className={`mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Компания
            </p>
            <p className="mt-2 truncate text-sm font-semibold text-gray-900">
              {currentCompany?.name || 'Компания не выбрана'}
            </p>
            <p className="mt-1 text-xs capitalize text-gray-500">
              {currentCompany?.role || 'Без роли'}
            </p>
            <select
              value={selectedCompanyId}
              onChange={handleCompanyChange}
              disabled={companies.length <= 1}
              className="mt-3 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div className={`mb-3 flex items-center ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500" title={sidebarCollapsed ? user?.full_name || user?.username : undefined}>
              <span className="text-sm font-medium text-white">
                {user?.username?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className={`ml-3 min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
              <p className="truncate text-sm font-medium text-gray-900">
                {user?.full_name || user?.username}
              </p>
              <p className="text-xs text-gray-500 truncate">{currentCompany?.slug || 'Нет компании'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title={sidebarCollapsed ? 'Выйти' : undefined}
            className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 ${
              sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''
            }`}
          >
            <ArrowRightOnRectangleIcon className={`h-5 w-5 shrink-0 ${sidebarCollapsed ? 'mr-3 lg:mr-0' : 'mr-3'}`} />
            <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Выйти</span>
          </button>
        </div>
      </div>

      <div className={`flex h-screen flex-col overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
        <header className="z-30 flex-none bg-white shadow-sm">
          <div className="flex h-14 items-center justify-between px-4 sm:h-16 sm:px-6">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-md p-2 hover:bg-gray-100 lg:hidden"
            >
              <Bars3Icon className="h-5 w-5 text-gray-500 sm:h-6 sm:w-6" />
            </button>

            <div className="flex items-center space-x-4">
              <ConnectionStatus />
              <div className="hidden sm:block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {currentCompany?.name || 'Нет компании'}
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

        <main className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 sm:p-6 sm:pb-6">{children}</main>
      </div>
    </div>
  );
}
