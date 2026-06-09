'use client';

import { useServerHealth } from '@/providers/ServerHealthProvider';

export function ConnectionStatus() {
  const { isServerReachable, isChecking, isNavigatorOnline } = useServerHealth();

  if (!isNavigatorOnline) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <span className="text-red-600">Офлайн</span>
      </div>
    );
  }

  if (isChecking) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-amber-600">Проверка...</span>
      </div>
    );
  }

  if (isServerReachable) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        <span className="text-green-700">Онлайн</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
      <span className="text-red-600">Офлайн</span>
    </div>
  );
}
