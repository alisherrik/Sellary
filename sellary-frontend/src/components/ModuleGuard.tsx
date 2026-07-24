'use client';

import Link from 'next/link';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { useModules } from '@/lib/store';
import { canAccessModule, type ModuleKey, type ModuleLevel } from '@/lib/modules';
import { moduleLabel } from '@/lib/moduleNav';

interface ModuleGuardProps {
  module: ModuleKey;
  level?: ModuleLevel;
  children: React.ReactNode;
}

export function ModuleGuard({ module, level = 'user', children }: ModuleGuardProps) {
  const modules = useModules();
  if (!canAccessModule(modules, module, level)) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 px-10 text-center">
        <div className="mb-2 grid h-16 w-16 place-items-center border-2 border-[var(--erp-divider)]">
          <LockClosedIcon className="h-7 w-7 text-[var(--erp-accent)]" />
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-[var(--erp-text)]">
          Нет доступа к этому разделу
        </h2>
        <p className="mb-2 max-w-[44ch] text-sm text-gray-500">
          Модуль «{moduleLabel(module)}» не выдан вашей учётной записи. Обратитесь к
          администратору, чтобы получить доступ.
        </p>
        <Link
          href="/apps"
          prefetch={false}
          className="flex h-10 items-center bg-[var(--erp-accent)] px-5 text-sm font-semibold text-white"
        >
          К приложениям
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
