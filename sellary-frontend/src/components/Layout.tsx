'use client';

import { ChangeEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Squares2X2Icon,
  BuildingOffice2Icon,
  ChevronDownIcon,
  LockClosedIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore, useModules } from '@/lib/store';
import { canAccessModule, type ModuleKey } from '@/lib/modules';
import { MODULE_NAV, moduleForPath, pageForPath } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';
import { usePrefetchOnHover } from '@/hooks/useQueries';
import { ConnectionStatus } from './ui/ConnectionStatus';

interface LayoutProps {
  children: ReactNode;
}

// href -> prefetch key, for hovering a secondary-sidebar page button.
const PREFETCH_BY_HREF: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/products': 'products',
  '/sales': 'sales',
  '/suppliers': 'suppliers',
  '/customers': 'customers',
  '/purchase-orders': 'purchaseOrders',
};

export default function Layout({ children }: LayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout, currentCompany, companies, switchCompany } = useAuthStore();
  const modules = useModules();
  const prefetch = usePrefetchOnHover();
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>(currentCompany?.id ?? '');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  useEffect(() => {
    setSelectedCompanyId(currentCompany?.id ?? '');
  }, [currentCompany?.id]);

  const handlePrefetch = useCallback(
    (href: string) => {
      const key = PREFETCH_BY_HREF[href];
      switch (key) {
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
    [prefetch],
  );

  const handleCompanyChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const companyId = Number(event.target.value);
    if (!companyId || companyId === currentCompany?.id) {
      return;
    }

    setSelectedCompanyId(companyId);
    try {
      await switchCompany(companyId);
      queryClient.clear();
      router.replace('/apps');
      toast.success('Компания успешно переключена.');
    } catch (error: any) {
      setSelectedCompanyId(currentCompany?.id ?? '');
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось переключить компанию.',
      );
    }
  };

  // POS brings its own fullscreen chrome (see pos/page.tsx) — no header/rail/sidebar.
  if (pathname.startsWith('/pos')) {
    return <>{children}</>;
  }

  const isAdmin = currentCompany?.role === 'admin';
  const currentModule = moduleForPath(pathname);
  const currentPage = pageForPath(pathname);
  const currentModuleLevel =
    currentModule && currentModule.key !== 'settings'
      ? modules[currentModule.key as ModuleKey]
      : undefined;

  const railModules = MODULE_NAV.filter((def) =>
    def.key === 'settings' ? isAdmin : canAccessModule(modules, def.key as ModuleKey),
  );

  const showSecondary = pathname !== '/apps' && currentModule !== null;

  const levelLabel = isAdmin ? 'Администратор' : currentModuleLevel === 'manager' ? 'Менеджер' : 'Сотрудник';
  const levelIsElevated = isAdmin || currentModuleLevel === 'manager';

  return (
    <div className="flex h-screen flex-col bg-[var(--erp-bg)] text-[var(--erp-text)]">
      <header className="flex h-14 flex-none items-center gap-3.5 border-b-2 border-[var(--erp-divider)] bg-white px-[18px]">
        <Link
          href="/apps"
          prefetch={false}
          className="text-[19px] font-extrabold tracking-tight text-[var(--erp-text)]"
        >
          Sellary
        </Link>
        <Link
          href="/apps"
          prefetch={false}
          className="flex h-[34px] items-center gap-2 border border-[var(--erp-divider)] px-3 text-sm font-medium text-[var(--erp-text)] hover:bg-[var(--erp-surface)]"
        >
          <Squares2X2Icon className="h-[15px] w-[15px]" />
          Приложения
        </Link>

        {currentModule && (
          <div className="flex items-center gap-2 text-sm">
            <span className="h-1.5 w-1.5 bg-[var(--erp-accent)]" />
            <span className="font-extrabold">{currentModule.label}</span>
            {currentPage && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-gray-500">{currentPage.label}</span>
              </>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3.5">
          <ConnectionStatus />

          <div className="relative flex h-9 items-center gap-2 border border-[var(--erp-divider)] px-2.5 text-[13px]">
            <BuildingOffice2Icon className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">{currentCompany?.name || 'Нет компании'}</span>
            <ChevronDownIcon className="h-3 w-3 opacity-50" />
            <select
              aria-label="Сменить компанию"
              value={selectedCompanyId}
              onChange={handleCompanyChange}
              disabled={companies.length <= 1}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="flex items-center gap-2.5"
            >
              <div className="grid h-[34px] w-[34px] place-items-center bg-[var(--erp-accent)] text-sm font-extrabold text-white">
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <div className="text-left leading-tight">
                <div className="text-[13px] font-semibold">{user?.full_name || user?.username}</div>
                <div className="text-[11px] capitalize text-gray-500">{currentCompany?.role || ''}</div>
              </div>
            </button>
            {accountMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAccountMenuOpen(false)} />
                <div className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[160px] border border-[var(--erp-divider)] bg-white shadow-md">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-[var(--erp-surface)]"
                  >
                    <ArrowRightOnRectangleIcon className="h-4 w-4" />
                    Выйти
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[74px] flex-none flex-col items-center gap-1 border-r-2 border-[var(--erp-divider)] bg-[var(--erp-surface)] pt-3">
          {railModules.map((def) => {
            const Icon = MODULE_ICONS[def.key];
            const isActive = currentModule?.key === def.key;
            const href = def.pages[0]?.href ?? '/apps';
            return (
              <Link
                key={def.key}
                href={href}
                prefetch={false}
                title={def.label}
                className={`flex w-16 flex-col items-center gap-1 py-2.5 text-center ${
                  isActive
                    ? 'bg-white text-[var(--erp-accent)]'
                    : 'text-[var(--erp-text)] hover:bg-black/5'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[9.5px] font-semibold tracking-tight">{def.label}</span>
              </Link>
            );
          })}
        </nav>

        {showSecondary && currentModule && (
          <aside className="flex w-[216px] flex-none flex-col border-r-2 border-[var(--erp-divider)] bg-white p-4">
            <div className="px-2 pb-1 text-[15px] font-extrabold">{currentModule.label}</div>
            <div className="px-2 pb-3 text-[10px] uppercase tracking-[0.1em] text-gray-400">
              {currentModule.tagline}
            </div>
            <div className="flex flex-col gap-0.5">
              {currentModule.pages
                .filter((page) => page.href !== '/pos')
                .map((page) => {
                  const isActive = currentPage?.href === page.href;
                  const locked =
                    !isAdmin && page.managerOnly && currentModuleLevel !== 'manager';
                  const className = `flex items-center justify-between px-2 py-2 text-left text-sm ${
                    isActive
                      ? 'bg-[var(--erp-text)] text-white'
                      : locked
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-[var(--erp-surface)]'
                  }`;

                  if (locked) {
                    return (
                      <div key={page.href} className={className}>
                        <span>{page.label}</span>
                        <LockClosedIcon className="h-3.5 w-3.5 opacity-55" />
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      prefetch={false}
                      onMouseEnter={() => handlePrefetch(page.href)}
                      className={className}
                    >
                      <span>{page.label}</span>
                      {page.managerOnly && <LockClosedIcon className="h-3.5 w-3.5 opacity-55" />}
                    </Link>
                  );
                })}
            </div>
            <div className="mt-auto border-t border-[var(--erp-divider)] pl-2 pt-3">
              <div className="text-[10px] uppercase tracking-[0.1em] text-gray-400">
                Уровень доступа
              </div>
              <div
                className={`mt-0.5 text-sm font-extrabold ${
                  levelIsElevated ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-text)]'
                }`}
              >
                {levelLabel}
              </div>
            </div>
          </aside>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--erp-bg)]">{children}</main>
      </div>
    </div>
  );
}
