import { formatCurrency } from '../../lib/format';

const START = 8;
const END = 22;

export function HourlyChart({ hourly }: { hourly: number[] }) {
  const slice = Array.from({ length: END - START + 1 }, (_, i) => ({
    hour: START + i,
    value: Number(hourly?.[START + i] ?? 0),
  }));
  const total = slice.reduce((sum, b) => sum + b.value, 0);
  if (total <= 0) return null;
  const max = Math.max(1, ...slice.map((b) => b.value));

  return (
    <div className="mb-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Оборот по часам</p>
        <span className="text-[11px] text-gray-400">08:00 – 22:00</span>
      </div>
      <div className="flex h-20 items-end gap-1">
        {slice.map((b) => (
          <div key={b.hour} className="flex flex-1 flex-col items-center gap-1" title={`${b.hour}:00 — ${formatCurrency(b.value)}`}>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-blue-500/80 transition-all hover:bg-blue-600"
                style={{ height: `${Math.max(b.value > 0 ? 6 : 0, (b.value / max) * 100)}%` }}
              />
            </div>
            <span className="text-[9px] tabular-nums text-gray-400">{b.hour}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
