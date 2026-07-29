'use client';

import { useRouter, usePathname } from 'next/navigation';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { useAuthStore, useModules } from '@/lib/store';
import { grantedModuleDefs } from '@/lib/moduleNav';
import { helpUrlFor } from '@/lib/help';
import { MODULE_ICONS } from '@/components/moduleIcons';
import BottomSheet from './BottomSheet';

interface MoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

// The mobile shell has no secondary sidebar, so this sheet is the only place
// to reach a module's non-first pages (e.g. Закупки → /purchase-orders,
// Отчеты → /reports) — it lists every granted module, tab-visible or not,
// grouped by module with its full page list underneath.
export default function MoreSheet({ isOpen, onClose }: MoreSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const modules = useModules();
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const groups = grantedModuleDefs(modules, isAdmin);

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Все разделы">
      <div className="px-4 pb-8 pt-4">
        <div className="space-y-5">
          {groups.map((def) => {
            const Icon = MODULE_ICONS[def.key];
            return (
              <div key={def.key}>
                <div className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--erp-muted)]">
                  <Icon className="h-4 w-4" />
                  {def.label}
                </div>
                <div>
                  {def.pages.map((page) => {
                    const active = isActive(page.href);
                    return (
                      <button
                        key={page.href}
                        type="button"
                        onClick={() => handleNavigate(page.href)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] ${
                          active ? 'bg-[var(--erp-surface)]' : ''
                        }`}
                      >
                        <span
                          className={`text-[14px] font-bold ${
                            active ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-text)]'
                          }`}
                        >
                          {page.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* The mobile shell has no header, so this sheet is the only way to
            the manual. Opens the chapter for the page in view. */}
        <a
          href={helpUrlFor(pathname)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="mt-6 flex min-h-[44px] items-center gap-2.5 border-t border-[var(--erp-divider)] px-3 pt-4 text-[14px] font-bold text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
        >
          <QuestionMarkCircleIcon className="h-4 w-4" />
          Помощь
        </a>
      </div>
    </BottomSheet>
  );
}
