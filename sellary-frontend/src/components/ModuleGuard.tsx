'use client';

import { useModules } from '@/lib/store';
import { canAccessModule, type ModuleKey, type ModuleLevel } from '@/lib/modules';

interface ModuleGuardProps {
  module: ModuleKey;
  level?: ModuleLevel;
  children: React.ReactNode;
}

export function ModuleGuard({ module, level = 'user', children }: ModuleGuardProps) {
  const modules = useModules();
  if (!canAccessModule(modules, module, level)) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-semibold">Нет доступа к этому разделу</p>
        <p className="text-sm text-gray-500">
          Обратитесь к администратору, чтобы получить доступ.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
