export interface BadgeMeta {
  label: string;
  cls: string;
}

/** Pure mapping of the local sale sync state to a label + Tailwind classes. */
export function badgeMeta(syncStatus: string, errorKind?: string | null): BadgeMeta {
  if (syncStatus === 'synced') {
    return { label: 'Синхронизировано', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' };
  }
  if (syncStatus === 'failed' && errorKind === 'permanent') {
    return { label: 'Требует внимания', cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300' };
  }
  if (syncStatus === 'failed') {
    return { label: 'Повтор', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' };
  }
  if (syncStatus === 'syncing') {
    return { label: 'Синхронизация…', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' };
  }
  return { label: 'Ожидает', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
}

export function SyncStatusBadge({ syncStatus, errorKind }: { syncStatus: string; errorKind?: string | null }) {
  const meta = badgeMeta(syncStatus, errorKind);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
