'use client';

import { useSettingsStore, CURRENCIES, CurrencyCode } from '@/store/settingsStore';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { isOfflineModeEnabled, isRestaurantEnabled } from '@/lib/features';
import {
  BanknotesIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
        enabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'
      }`}
    >
      {enabled ? 'Включено' : 'Выключено'}
    </span>
  );
}

export default function SettingsPage() {
  const { currency, setCurrency } = useSettingsStore();
  const { isServerReachable, isChecking } = useServerHealth();

  const handleCurrencyChange = (code: CurrencyCode) => {
    setCurrency(code);
    toast.success(`Валюта ${CURRENCIES[code].code} сохранена`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-20">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-blue-100 p-3">
          <Cog6ToothIcon className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Настройки</h1>
          <p className="text-sm text-gray-500">Операционные и интерфейсные настройки MVP</p>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <BanknotesIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Валюта</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Цены, отчеты и кассовые суммы будут отображаться в этой валюте.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
          {(Object.values(CURRENCIES) as Array<(typeof CURRENCIES)[CurrencyCode]>).map((curr) => {
            const isSelected = currency === curr.code;
            return (
              <button
                key={curr.code}
                onClick={() => handleCurrencyChange(curr.code)}
                className={`relative rounded-2xl border-2 p-4 text-left transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50'
                }`}
              >
                {isSelected && (
                  <CheckCircleIcon className="absolute right-3 top-3 h-5 w-5 text-blue-500" />
                )}

                <div className={`mb-2 text-2xl ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                  {curr.symbol}
                </div>
                <div className="text-sm font-semibold text-gray-900">{curr.code}</div>
                <div className="mt-1 text-xs text-gray-500">{curr.name}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Статус MVP</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Быстрый обзор того, какие модули активны в текущем релизе.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Сервер</div>
            <div className="mt-3">
              {isChecking ? (
                <StatusBadge enabled={false} />
              ) : (
                <StatusBadge enabled={isServerReachable} />
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Розничная касса</div>
            <div className="mt-3">
              <StatusBadge enabled />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Ресторан</div>
            <div className="mt-3">
              <StatusBadge enabled={isRestaurantEnabled} />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Оффлайн-синхронизация</div>
            <div className="mt-3">
              <StatusBadge enabled={isOfflineModeEnabled} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:p-6">
        <h2 className="text-base font-semibold text-blue-900">Примечание по MVP</h2>
        <p className="mt-2 text-sm leading-6 text-blue-800">
          Страница настроек намеренно упрощена. Для пилота мы оставили только те параметры,
          которые нужны кассиру и владельцу, а расширенные сценарии перенесли на следующий этап.
        </p>
      </section>
    </div>
  );
}
