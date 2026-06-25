'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BanknotesIcon, PrinterIcon, ServerIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

import CompanyAdminSection from '@/components/settings/CompanyAdminSection';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { CURRENCIES, CurrencyCode, useSettingsStore } from '@/store/settingsStore';

function StatusBadge({
  enabled,
  activeLabel = 'Включено',
  inactiveLabel = 'Отключено',
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
  const { currency, setCurrency, receiptPrintEnabled, setReceiptPrintEnabled } = useSettingsStore();
  const { isServerReachable, isChecking } = useServerHealth();
  const [backendVersion, setBackendVersion] = useState<string | null>(null);

  const frontendVersion = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';

  useEffect(() => {
    if (isServerReachable) {
      fetch('/health', { method: 'GET' })
        .then((res) => res.json())
        .then((data) => {
          if (data?.version) {
            setBackendVersion(data.version);
          }
        })
        .catch(() => setBackendVersion(null));
    }
  }, [isServerReachable]);

  const handleCurrencyChange = (code: CurrencyCode) => {
    setCurrency(code);
    toast.success(`Валюта изменена на ${CURRENCIES[code].name}.`);
  };

  const handleReceiptPrintToggle = () => {
    const next = !receiptPrintEnabled;
    setReceiptPrintEnabled(next);
    toast.success(next ? 'Печать чека включена.' : 'Печать чека отключена.');
  };

  return (
    <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-6">
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <BanknotesIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Валюта</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Выберите валюту по умолчанию, используемую в ценах, отчётах и чеках.
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

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <PrinterIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Печать чека</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Управляйте печатью чека после продажи. Когда печать выключена — после
            продажи ничего не печатается и не открывается окно «Сохранить как PDF».
          </p>
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">
                Печатать чек после продажи
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Включите, когда подключён принтер. Чтобы чек печатался сразу, без
                диалога и PDF: сделайте чековый принтер принтером по умолчанию в
                Windows и запускайте Chrome с флагом{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">
                  --kiosk-printing
                </code>
                .
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={receiptPrintEnabled}
              aria-label="Печатать чек после продажи"
              onClick={handleReceiptPrintToggle}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                receiptPrintEnabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  receiptPrintEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="mt-4">
            <StatusBadge
              enabled={receiptPrintEnabled}
              activeLabel="Печать включена"
              inactiveLabel="Печать отключена"
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Статус релиза</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Быстрый обзор того, какие модули MVP доступны в данный момент.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Backend</div>
            <div className="mt-3">
              {isChecking ? (
                <StatusBadge enabled={false} activeLabel="В сети" inactiveLabel="Проверка" />
              ) : (
                <StatusBadge
                  enabled={isServerReachable}
                  activeLabel="В сети"
                  inactiveLabel="Не в сети"
                />
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Розничная касса</div>
            <div className="mt-3">
              <StatusBadge enabled activeLabel="Активно" inactiveLabel="Отключено" />
            </div>
          </div>

        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Версия</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Развёрнутые версии сервера и клиента.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Сервер</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {isServerReachable && backendVersion ? `v${backendVersion}` : '—'}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {isChecking ? 'Проверка...' : isServerReachable ? 'Railway' : 'Недоступен'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">Клиент</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              v{frontendVersion}
            </div>
            <div className="mt-1 text-xs text-gray-500">Netlify</div>
          </div>
        </div>
      </section>

      <CompanyAdminSection />
    </div>
  );
}
