// Matches the canonical HistoryFilter['syncFilter'] union from INDEX §4.5 ('attention', NOT 'needs_attention').
export type SyncFilter = 'all' | 'synced' | 'unsynced' | 'attention';

const TABS: { key: SyncFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'synced', label: 'Синхронизировано' },
  { key: 'unsynced', label: 'Не синхронизировано' },
  { key: 'attention', label: 'Требует внимания' },
];

export function SyncStatusTabs({
  value,
  onChange,
  needsAttentionCount = 0,
}: {
  value: SyncFilter;
  onChange: (value: SyncFilter) => void;
  needsAttentionCount?: number;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
            value === tab.key
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          {tab.label}
          {tab.key === 'attention' && needsAttentionCount > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
              {needsAttentionCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
