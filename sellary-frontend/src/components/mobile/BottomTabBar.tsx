'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { useAuthStore, useModules } from '@/lib/store';
import { grantedModuleDefs, MOBILE_MAX_TABS } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';

interface BottomTabBarProps {
  onMoreClick: () => void;
}

// Module-first bottom bar: one tab per granted module (in MODULE_NAV order),
// each routing straight to that module's first page. Modules beyond the
// first MOBILE_MAX_TABS fold into the "Ещё" tab/sheet instead of a tab of
// their own — see MoreSheet for what lands there.
export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const pathname = usePathname();
  const modules = useModules();
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const granted = grantedModuleDefs(modules, isAdmin);
  const tabs = granted.slice(0, MOBILE_MAX_TABS);
  const hasMore = granted.length > MOBILE_MAX_TABS;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      className="flex h-[58px] shrink-0 items-center border-t-2 border-[var(--erp-divider)] bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map((def) => {
        const href = def.pages[0]?.href ?? '/apps';
        const active = isActive(href);
        const Icon = MODULE_ICONS[def.key];
        return (
          <Link
            key={def.key}
            href={href}
            prefetch={false}
            className="flex flex-1 flex-col items-center justify-center gap-1 py-1"
          >
            <Icon
              className={`h-5 w-5 ${active ? 'text-[var(--erp-accent)]' : 'text-gray-400'}`}
            />
            <span
              className={`text-[9px] font-semibold ${
                active ? 'text-[var(--erp-accent)]' : 'text-gray-400'
              }`}
            >
              {def.label}
            </span>
          </Link>
        );
      })}

      {hasMore && (
        <button
          onClick={onMoreClick}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-1"
        >
          <EllipsisHorizontalIcon className="h-5 w-5 text-gray-400" />
          <span className="text-[9px] font-semibold text-gray-400">Ещё</span>
        </button>
      )}
    </nav>
  );
}
