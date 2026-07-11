import type { DebtFilter } from './customerFilter';

interface Tab {
  key: DebtFilter;
  label: string;
  count: number;
}

export function DebtFilterTabs({
  value,
  onChange,
  counts,
}: {
  value: DebtFilter;
  onChange: (f: DebtFilter) => void;
  counts: { all: number; debt: number; clear: number };
}) {
  const tabs: Tab[] = [
    { key: 'all', label: 'Все', count: counts.all },
    { key: 'debt', label: 'Есть долг', count: counts.debt },
    { key: 'clear', label: 'Нет долга', count: counts.clear },
  ];
  return (
    <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-label={tab.label}
          onClick={() => onChange(tab.key)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            value === tab.key
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          <span>{tab.label}</span>
          <span className="text-xs tabular-nums text-gray-400">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}
