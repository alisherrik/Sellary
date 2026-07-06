'use client';

import { ReactNode, useState, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MobileHeader from './MobileHeader';
import BottomTabBar from './BottomTabBar';
import MoreSheet from './MoreSheet';

interface MobileShellProps {
  children: ReactNode;
}

const headerTitles: Record<string, string> = {
  '/pos': 'Касса',
  '/products': 'Товары',
  '/sales': 'История продаж',
  '/dashboard': 'Дашборд',
  '/customers': 'Клиенты',
  '/suppliers': 'Поставщики',
  '/purchase-orders': 'Закупки',
  '/reports': 'Отчеты',
  '/settings': 'Настройки',
};

function getHeaderTitle(pathname: string): string {
  for (const [path, title] of Object.entries(headerTitles)) {
    if (pathname === path || (path !== '/pos' && path !== '/dashboard' && pathname.startsWith(path))) {
      return title;
    }
  }
  return '';
}

export default function MobileShell({ children }: MobileShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  const title = useMemo(() => getHeaderTitle(pathname), [pathname]);
  const showBack = pathname.split('/').filter(Boolean).length > 1;

  return (
    <div className="flex h-dvh flex-col bg-gray-50">
      <MobileHeader
        title={title}
        showBack={showBack}
        onBack={() => router.back()}
      />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {children}
      </div>
      <BottomTabBar onMoreClick={() => setMoreOpen(true)} />
      <MoreSheet isOpen={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  );
}
