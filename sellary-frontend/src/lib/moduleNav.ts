import { canAccessModule, type ModuleKey, type ModuleMap } from './modules';

export interface ModulePage {
  label: string;
  href: string;
  managerOnly?: boolean;
}

export interface ModuleDef {
  key: ModuleKey | 'settings';
  label: string;
  tagline: string;
  pages: ModulePage[];
}

// Single source of nav truth for the workspace shell: rail buttons, launcher
// cards, secondary sidebar page lists, and breadcrumb/module lookups all read
// from this table. Keep it in sync with the actual (protected) routes — do
// not list a page here that has no corresponding route.
export const MODULE_NAV: ModuleDef[] = [
  {
    key: 'pos',
    label: 'Касса',
    tagline: 'Продажи, чеки, смены, клиенты',
    pages: [
      { label: 'Касса', href: '/pos' },
      { label: 'История продаж', href: '/sales' },
      { label: 'Смена', href: '/shifts' },
      { label: 'Клиенты', href: '/customers' },
    ],
  },
  {
    key: 'inventory',
    label: 'Склад',
    tagline: 'Товары, категории, инвентаризация',
    pages: [{ label: 'Товары', href: '/products' }],
  },
  {
    key: 'purchasing',
    label: 'Закупки',
    tagline: 'Поставщики и заказы поставщикам',
    pages: [
      { label: 'Поставщики', href: '/suppliers' },
      { label: 'Заказы поставщикам', href: '/purchase-orders' },
    ],
  },
  {
    key: 'shop',
    label: 'Магазин',
    tagline: 'Заказы из Telegram-магазина',
    pages: [{ label: 'Заказы', href: '/orders' }],
  },
  {
    key: 'reports',
    label: 'Отчеты',
    tagline: 'Дашборд и аналитика продаж',
    pages: [
      { label: 'Дашборд', href: '/dashboard' },
      { label: 'Аналитика', href: '/reports' },
    ],
  },
  {
    key: 'settings',
    label: 'Настройки',
    tagline: 'Компания, маркетплейс, сотрудники',
    pages: [{ label: 'Настройки', href: '/settings' }],
  },
];

/** Look up a module definition by its rail/nav key. */
export function moduleByKey(key: ModuleKey | 'settings'): ModuleDef | undefined {
  return MODULE_NAV.find((def) => def.key === key);
}

/** Mobile bottom bar shows at most this many module tabs before folding the rest into «Ещё». */
export const MOBILE_MAX_TABS = 4;

/**
 * Modules the current user may open, in the canonical MODULE_NAV order
 * (pos, inventory, purchasing, shop, reports, settings). `settings` is
 * included only for admins — mirrors the desktop rail/launcher and the
 * mobile shell's tab-bar + "Ещё" sheet, keeping module-visibility logic in
 * one place.
 */
export function grantedModuleDefs(modules: ModuleMap, isAdmin: boolean): ModuleDef[] {
  return MODULE_NAV.filter((def) =>
    def.key === 'settings' ? isAdmin : canAccessModule(modules, def.key as ModuleKey),
  );
}

/**
 * Whether the mobile "Ещё" tab/sheet has anything worth showing. It's needed
 * not just when modules overflow past MOBILE_MAX_TABS, but also whenever a
 * granted module has secondary pages — those pages have no other entry
 * point on mobile (no secondary sidebar), even when the module itself is one
 * of the visible tabs. See MoreSheet, which lists every granted module's
 * full page list.
 */
export function shouldShowMoreTab(modules: ModuleMap, isAdmin: boolean): boolean {
  const granted = grantedModuleDefs(modules, isAdmin);
  return granted.length > MOBILE_MAX_TABS || granted.some((def) => def.pages.length > 1);
}

/** Display label for a module key, falling back to the key itself. */
export function moduleLabel(key: ModuleKey | 'settings'): string {
  return moduleByKey(key)?.label ?? key;
}

/**
 * Resolve which module+page a pathname belongs to, via longest-prefix match
 * over every page href in the registry (query strings ignored). Returns null
 * for paths outside the registry (e.g. /apps).
 */
export function moduleForPath(pathname: string): ModuleDef | null {
  return resolveNav(pathname)?.module ?? null;
}

/** Resolve the specific page entry (module + page) a pathname belongs to. */
export function pageForPath(pathname: string): ModulePage | null {
  return resolveNav(pathname)?.page ?? null;
}

function resolveNav(pathname: string): { module: ModuleDef; page: ModulePage } | null {
  const path = pathname.split('?')[0];
  let best: { def: ModuleDef; page: ModulePage; len: number } | null = null;

  for (const def of MODULE_NAV) {
    for (const page of def.pages) {
      const href = page.href.split('?')[0];
      const matches = path === href || path.startsWith(`${href}/`);
      if (matches && (!best || href.length > best.len)) {
        best = { def, page, len: href.length };
      }
    }
  }

  return best ? { module: best.def, page: best.page } : null;
}
