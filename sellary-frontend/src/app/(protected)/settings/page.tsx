'use client';

import toast from 'react-hot-toast';
import { BanknotesIcon, Cog6ToothIcon, ServerIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

import CompanyAdminSection from '@/components/settings/CompanyAdminSection';
import SyncControls from '@/components/settings/SyncControls';
import { isOfflineModeEnabled, isRestaurantEnabled } from '@/lib/features';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { CURRENCIES, CurrencyCode, useSettingsStore } from '@/store/settingsStore';

function StatusBadge({
  enabled,
  activeLabel = 'Enabled',
  inactiveLabel = 'Disabled',
}: {
  enabled: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
        enabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'
      }`}
    >
      {enabled ? activeLabel : inactiveLabel}
    </span>
  );
}

export default function SettingsPage() {
  const { currency, setCurrency } = useSettingsStore();
  const { isServerReachable, isChecking } = useServerHealth();

  const handleCurrencyChange = (code: CurrencyCode) => {
    setCurrency(code);
    toast.success(`Currency changed to ${CURRENCIES[code].name}.`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-20">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-blue-100 p-2">
          <Cog6ToothIcon className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Adjust local preferences and company admin controls.</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <BanknotesIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Currency</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Choose the default currency used across prices, reports, and receipts.
          </p>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.values(CURRENCIES) as Array<(typeof CURRENCIES)[CurrencyCode]>).map((curr) => {
              const isSelected = currency === curr.code;
              return (
                <button
                  key={curr.code}
                  onClick={() => handleCurrencyChange(curr.code)}
                  className={`relative flex flex-col items-start rounded-xl border-2 p-4 transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute right-2 top-2">
                      <CheckCircleIcon className="h-5 w-5 text-blue-500" />
                    </div>
                  )}

                  <span className={`mb-2 text-2xl ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                    {curr.symbol}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{curr.code}</span>
                  <span className="mt-1 text-left text-xs text-gray-500">{curr.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <SyncControls />
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Release Status</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Quick visibility into which MVP modules are currently available.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Backend</div>
            <div className="mt-3">
              {isChecking ? (
                <StatusBadge enabled={false} activeLabel="Online" inactiveLabel="Checking" />
              ) : (
                <StatusBadge
                  enabled={isServerReachable}
                  activeLabel="Online"
                  inactiveLabel="Offline"
                />
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Retail POS</div>
            <div className="mt-3">
              <StatusBadge enabled activeLabel="Live" inactiveLabel="Disabled" />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Restaurant</div>
            <div className="mt-3">
              <StatusBadge enabled={isRestaurantEnabled} />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Offline Sync</div>
            <div className="mt-3">
              <StatusBadge enabled={isOfflineModeEnabled} />
            </div>
          </div>
        </div>
      </section>

      <CompanyAdminSection />
    </div>
  );
}
