'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore, useModules } from '@/lib/store';
import { grantedModuleDefs, MOBILE_MAX_TABS } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';

interface MoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

// Holds whatever granted modules didn't make the bottom bar's first
// MOBILE_MAX_TABS slots (see BottomTabBar). Each row opens that module's
// first page, same as tapping its tab would.
export default function MoreSheet({ isOpen, onClose }: MoreSheetProps) {
  const router = useRouter();
  const modules = useModules();
  const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
  const overflowModules = grantedModuleDefs(modules, isAdmin).slice(MOBILE_MAX_TABS);

  if (!isOpen) return null;

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 animate-scale-in" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 animate-slide-up border-t-2 border-[var(--erp-divider)] bg-white pb-safe">
        <div className="mx-auto mt-3 h-1 w-8 bg-gray-300" />
        <div className="mt-4 px-4 pb-8">
          <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.15em] text-[var(--erp-accent)]">
            Ещё
          </h2>
          <div className="space-y-1">
            {overflowModules.map((def) => {
              const Icon = MODULE_ICONS[def.key];
              const href = def.pages[0]?.href ?? '/apps';
              return (
                <button
                  key={def.key}
                  onClick={() => handleNavigate(href)}
                  className="flex w-full items-center gap-3 border border-transparent px-3 py-3 hover:border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                >
                  <Icon className="h-5 w-5 text-[var(--erp-text)]" />
                  <span className="text-[14px] font-extrabold tracking-tight text-[var(--erp-text)]">
                    {def.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
