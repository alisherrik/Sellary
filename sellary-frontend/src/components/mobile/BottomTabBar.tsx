'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { useAuthStore, useModules } from '@/lib/store';
import { grantedModuleDefs, pageForPath, shouldShowMoreTab, MOBILE_MAX_TABS } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';

interface BottomTabBarProps {
  onMoreClick: () => void;
}

// Module-first bottom bar: one tab per granted module (in MODULE_NAV order),
// each routing straight to that module's first page. "Ещё" holds every
// granted module's full page list (see MoreSheet) — it's shown whenever a
// module overflows past MOBILE_MAX_TABS, or a visible module has secondary
// pages that wouldn't otherwise be reachable (no secondary sidebar on mobile).
export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const pathname = usePathname();
  const modules = useModules();
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const granted = grantedModuleDefs(modules, isAdmin);
  const tabs = granted.slice(0, MOBILE_MAX_TABS);
  const hasMore = shouldShowMoreTab(modules, isAdmin);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Highlight "Ещё" when the current page belongs to a granted module but
  // isn't the exact page a visible tab points to (e.g. /purchase-orders,
  // reachable only from the sheet while its tab still points at /suppliers).
  const currentPage = pageForPath(pathname);
  const tabHrefs = new Set(tabs.map((def) => def.pages[0]?.href));
  const moreActive = hasMore && !!currentPage && !tabHrefs.has(currentPage.href);

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
          <EllipsisHorizontalIcon
            className={`h-5 w-5 ${moreActive ? 'text-[var(--erp-accent)]' : 'text-gray-400'}`}
          />
          <span
            className={`text-[9px] font-semibold ${
              moreActive ? 'text-[var(--erp-accent)]' : 'text-gray-400'
            }`}
          >
            Ещё
          </span>
        </button>
      )}
    </nav>
  );
}
