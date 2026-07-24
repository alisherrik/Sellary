'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore, useModules } from '@/lib/store';
import { grantedModuleDefs } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';

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

  if (!isOpen) return null;

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 animate-scale-in" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto animate-slide-up border-t-2 border-[var(--erp-divider)] bg-white pb-safe">
        <div className="mx-auto mt-3 h-1 w-8 bg-gray-300" />
        <div className="mt-4 px-4 pb-8">
          <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.15em] text-[var(--erp-accent)]">
            Ещё
          </h2>
          <div className="space-y-4">
            {groups.map((def) => {
              const Icon = MODULE_ICONS[def.key];
              return (
                <div key={def.key}>
                  <div className="mb-1 flex items-center gap-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-gray-500">
                    <Icon className="h-3.5 w-3.5" />
                    {def.label}
                  </div>
                  <div className="space-y-0.5">
                    {def.pages.map((page) => {
                      const active = isActive(page.href);
                      return (
                        <button
                          key={page.href}
                          onClick={() => handleNavigate(page.href)}
                          className="flex w-full items-center border border-transparent px-3 py-2.5 text-left hover:border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
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
        </div>
      </div>
    </div>
  );
}
