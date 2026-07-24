'use client';

import Link from 'next/link';
import { useAuthStore, useModules } from '@/lib/store';
import type { ModuleKey } from '@/lib/modules';
import { grantedModuleDefs } from '@/lib/moduleNav';
import { MODULE_ICONS } from '@/components/moduleIcons';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export default function AppsPage() {
  const { currentCompany } = useAuthStore();
  const modules = useModules();
  const isAdmin = currentCompany?.role === 'admin';
  const isMobile = useMediaQuery('(max-width: 767px)');

  const granted = grantedModuleDefs(modules, isAdmin);
  const cards = granted.map((def) => {
    const level = def.key === 'settings' ? null : modules[def.key as ModuleKey];
    const badge = def.key === 'settings' ? 'Админ' : level === 'manager' ? 'Менеджер' : 'Сотрудник';
    const badgeElevated = def.key === 'settings' || level === 'manager';
    return { def, badge, badgeElevated };
  });

  if (isMobile) {
    return (
      <div className="px-4 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--erp-accent)]">
          Приложения
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {granted.map((def) => {
            const Icon = MODULE_ICONS[def.key];
            return (
              <Link
                key={def.key}
                href={def.pages[0]?.href ?? '/apps'}
                prefetch={false}
                className="flex flex-col items-start gap-2 border border-[var(--erp-divider)] bg-white p-4"
              >
                <Icon className="h-6 w-6 text-[var(--erp-text)]" />
                <span className="text-[13px] font-extrabold tracking-tight text-[var(--erp-text)]">
                  {def.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-10 py-14 pb-10">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--erp-accent)]">
        Рабочее пространство · {(currentCompany?.name || '').toUpperCase()}
      </div>
      <h1 className="mb-1 mt-2 text-[44px] font-extrabold tracking-tight text-[var(--erp-text)]">
        Приложения
      </h1>
      <p className="max-w-[60ch] text-[15px] text-gray-500">
        Выберите модуль. Вам доступны только выданные администратором приложения — каждое
        открывается как отдельное рабочее пространство.
      </p>

      <div className="mt-7 grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        {cards.map(({ def, badge, badgeElevated }) => {
          const Icon = MODULE_ICONS[def.key];
          return (
            <Link
              key={def.key}
              href={def.pages[0]?.href ?? '/apps'}
              prefetch={false}
              className="flex flex-col items-start border border-[var(--erp-divider)] bg-white p-5 text-left transition hover:border-[var(--erp-text)] hover:shadow-md"
            >
              <span className="flex w-full items-start justify-between">
                <span className="grid h-[46px] w-[46px] place-items-center border-2 border-[var(--erp-divider)]">
                  <Icon className="h-6 w-6 text-[var(--erp-text)]" />
                </span>
                <span
                  className={`px-2 py-0.5 text-[11px] font-semibold ${
                    badgeElevated
                      ? 'bg-[var(--erp-badge-bg)] text-[var(--erp-badge-text)]'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {badge}
                </span>
              </span>
              <span className="mt-4 w-full text-[20px] font-extrabold tracking-tight text-[var(--erp-text)]">
                {def.label}
              </span>
              <span className="w-full text-[12.5px] leading-snug text-gray-500">
                {def.tagline}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
