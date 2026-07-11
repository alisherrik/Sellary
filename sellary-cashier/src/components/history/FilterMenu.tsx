import { useState } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';

export type PaymentFilter = 'all' | 'cash' | 'card' | 'mobile';

const PAYMENT_OPTIONS: { value: PaymentFilter; label: string }[] = [
  { value: 'all', label: 'Все оплаты' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'mobile', label: 'Мобильный' },
];

export function FilterMenu({
  paymentMethod,
  startDate,
  endDate,
  onPaymentMethodChange,
  onStartDateChange,
  onEndDateChange,
  onReset,
}: {
  paymentMethod: PaymentFilter;
  startDate: string;
  endDate: string;
  onPaymentMethodChange: (value: PaymentFilter) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = (paymentMethod !== 'all' ? 1 : 0) + (startDate ? 1 : 0) + (endDate ? 1 : 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        <FunnelIcon className="h-4 w-4" />
        <span>Фильтры</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{activeCount}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Способ оплаты</span>
              <select
                aria-label="Способ оплаты"
                value={paymentMethod}
                onChange={(e) => onPaymentMethodChange(e.target.value as PaymentFilter)}
                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              >
                {PAYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Дата от</span>
                <input
                  type="date"
                  aria-label="Дата от"
                  value={startDate}
                  onChange={(e) => onStartDateChange(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Дата до</span>
                <input
                  type="date"
                  aria-label="Дата до"
                  value={endDate}
                  onChange={(e) => onEndDateChange(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
