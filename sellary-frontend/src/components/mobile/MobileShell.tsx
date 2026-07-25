'use client';

import { ReactNode, useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Squares2X2Icon, UserCircleIcon } from '@heroicons/react/24/outline';
import { moduleForPath, pageForPath } from '@/lib/moduleNav';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import MobileHeader from './MobileHeader';
import BottomTabBar from './BottomTabBar';
import MoreSheet from './MoreSheet';
import MobileAccountSheet from './MobileAccountSheet';

interface MobileShellProps {
  children: ReactNode;
}

// Titles come from moduleNav — the single source of nav truth — so a page
// added there is titled here without a second table to keep in sync. The
// launcher shows the app wordmark, per the mobile prototype's first frame.
function getHeaderTitle(pathname: string): string {
  return pageForPath(pathname)?.label ?? moduleForPath(pathname)?.label ?? 'Sellary';
}

/**
 * Connection state, shown only when it is not fine. The register is meant to
 * be calm at rest; a permanent green "Онлайн" chip earns nothing, but an
 * unreachable server has to be visible before a cashier builds a cart.
 */
function ConnectionDot() {
  const { isServerReachable, isNavigatorOnline, isChecking } = useServerHealth();
  const offline = !isNavigatorOnline || !isServerReachable;

  if (!offline && !isChecking) {
    return null;
  }

  return (
    <span
      role="status"
      aria-label={offline ? 'Нет связи с сервером' : 'Проверка связи'}
      className={`h-2 w-2 shrink-0 rounded-full ${offline ? 'bg-red-600' : 'animate-pulse bg-amber-500'}`}
    />
  );
}

export default function MobileShell({ children }: MobileShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const title = useMemo(() => getHeaderTitle(pathname), [pathname]);
  const showBack = pathname.split('/').filter(Boolean).length > 1;

  // A deep link (notification, shared URL) has no in-app history, so back()
  // would walk the user out of Sellary. Fall back to the launcher.
  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length <= 1) {
      router.push('/apps');
      return;
    }
    router.back();
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--erp-bg)]">
      <MobileHeader
        title={title}
        showBack={showBack}
        onBack={handleBack}
        leading={
          pathname === '/apps' ? undefined : (
            <Link
              href="/apps"
              prefetch={false}
              aria-label="Приложения"
              className="flex h-11 w-11 items-center justify-center hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
            >
              <Squares2X2Icon className="h-5 w-5 text-[var(--erp-text)]" />
            </Link>
          )
        }
        actions={
          <>
            <ConnectionDot />
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              aria-label="Аккаунт и компания"
              aria-haspopup="dialog"
              aria-expanded={accountOpen}
              className="flex h-11 w-11 items-center justify-center hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
            >
              <UserCircleIcon className="h-6 w-6 text-[var(--erp-text)]" />
            </button>
          </>
        }
      />
      <main
        id="main"
        data-shell-scroll
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        {children}
      </main>
      <BottomTabBar onMoreClick={() => setMoreOpen(true)} moreOpen={moreOpen} />
      <MoreSheet isOpen={moreOpen} onClose={() => setMoreOpen(false)} />
      {accountOpen && <MobileAccountSheet isOpen onClose={() => setAccountOpen(false)} />}
    </div>
  );
}
