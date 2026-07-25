'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { useAuthStore, useModules } from '@/lib/store';
import { grantedModuleDefs, pageForPath, shouldShowMoreTab, MOBILE_MAX_TABS } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';

interface BottomTabBarProps {
  onMoreClick: () => void;
  moreOpen?: boolean;
}

// Active tabs carry a 2px top rule as well as the accent color — the store
// floor is not a place to convey state by hue alone, and a color-only active
// state fails WCAG 1.4.1 for anyone who can't distinguish it.
const TAB_BASE =
  'relative flex flex-1 flex-col items-center justify-center gap-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]';

// Module-first bottom bar: one tab per granted module (in MODULE_NAV order),
// each routing straight to that module's first page. "Ещё" holds every
// granted module's full page list (see MoreSheet) — it's shown whenever a
// module overflows past MOBILE_MAX_TABS, or a visible module has secondary
// pages that wouldn't otherwise be reachable (no secondary sidebar on mobile).
export default function BottomTabBar({ onMoreClick, moreOpen = false }: BottomTabBarProps) {
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
      aria-label="Основная навигация"
      className="flex h-[58px] shrink-0 items-stretch border-t-2 border-[var(--erp-divider)] bg-white"
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
            aria-current={active ? 'page' : undefined}
            className={TAB_BASE}
          >
            {active && (
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-[var(--erp-accent)]" />
            )}
            <Icon
              className={`h-5 w-5 ${active ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'}`}
            />
            <span
              className={`text-[11px] font-semibold leading-none ${
                active ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'
              }`}
            >
              {def.label}
            </span>
          </Link>
        );
      })}

      {hasMore && (
        <button
          type="button"
          onClick={onMoreClick}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={TAB_BASE}
        >
          {moreActive && (
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-[var(--erp-accent)]" />
          )}
          <EllipsisHorizontalIcon
            className={`h-5 w-5 ${moreActive ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'}`}
          />
          <span
            className={`text-[11px] font-semibold leading-none ${
              moreActive ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'
            }`}
          >
            Ещё
          </span>
        </button>
      )}
    </nav>
  );
}
