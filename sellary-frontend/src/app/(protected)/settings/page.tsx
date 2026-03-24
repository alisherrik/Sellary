'use client';

import toast from 'react-hot-toast';
import { BanknotesIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

import CompanyAdminSection from '@/components/settings/CompanyAdminSection';
import SyncControls from '@/components/settings/SyncControls';
import { CURRENCIES, CurrencyCode, useSettingsStore } from '@/store/settingsStore';

export default function SettingsPage() {
  const { currency, setCurrency } = useSettingsStore();

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

      <CompanyAdminSection />
    </div>
  );
}
