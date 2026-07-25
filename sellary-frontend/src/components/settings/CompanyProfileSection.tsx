'use client';

import toast from 'react-hot-toast';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

import { useAuthStore } from '@/lib/store';
import { CURRENCIES, CurrencyCode, useSettingsStore } from '@/store/settingsStore';

import {
  FactRow,
  ROLE_LABELS,
  SettingsCard,
  SettingsToggle,
  StatusBadge,
} from './SettingsUI';

/**
 * Company profile: who this workspace belongs to, plus the two preferences
 * that change how money and receipts behave for everyone at this register.
 */
export default function CompanyProfileSection() {
  const currentCompany = useAuthStore((state) => state.currentCompany);
  const { currency, setCurrency, receiptPrintEnabled, setReceiptPrintEnabled } = useSettingsStore();

  const handleCurrencyChange = (code: CurrencyCode) => {
    if (code === currency) return;
    setCurrency(code);
    toast.success(`Валюта изменена на ${CURRENCIES[code].name}.`);
  };

  const handleReceiptPrintToggle = (next: boolean) => {
    setReceiptPrintEnabled(next);
    toast.success(next ? 'Печать чека включена.' : 'Печать чека отключена.');
  };

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Профиль компании"
        description="Реквизиты рабочего пространства, в котором вы сейчас работаете."
      >
        <dl className="max-w-[46rem]">
          <FactRow term="Название">{currentCompany?.name || '—'}</FactRow>
          <FactRow term="Идентификатор">
            <span className="font-mono text-[12px]">{currentCompany?.slug || '—'}</span>
          </FactRow>
          <FactRow term="Ваша роль">
            {currentCompany ? ROLE_LABELS[currentCompany.role] ?? currentCompany.role : '—'}
          </FactRow>
          <FactRow term="Состояние">
            {currentCompany?.is_active ? (
              <StatusBadge tone="ok">Активна</StatusBadge>
            ) : (
              <StatusBadge tone="idle">Неактивна</StatusBadge>
            )}
          </FactRow>
        </dl>
      </SettingsCard>

      <SettingsCard
        title="Валюта"
        description="Валюта по умолчанию, используемая в ценах, отчётах и чеках."
      >
        {/* Radio inputs, not buttons: one of four is chosen, and real radios
            bring arrow-key selection and the right announcement for free. */}
        <fieldset>
          <legend className="sr-only">Валюта по умолчанию</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(Object.values(CURRENCIES) as Array<(typeof CURRENCIES)[CurrencyCode]>).map((curr) => {
              const isSelected = currency === curr.code;
              return (
                <label key={curr.code} className="cursor-pointer">
                  <input
                    type="radio"
                    name="settings-currency"
                    value={curr.code}
                    checked={isSelected}
                    onChange={() => handleCurrencyChange(curr.code)}
                    className="peer sr-only"
                  />
                  {/* The ring rides a sibling of the visually-hidden input, so
                      keyboard focus stays visible without relying on :has(). */}
                  <span
                    className={`relative flex h-full min-h-[44px] flex-col border p-4 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--erp-accent)] ${
                      isSelected
                        ? 'border-[var(--erp-accent)] bg-white shadow-[inset_0_0_0_1px_var(--erp-accent)]'
                        : 'border-[var(--erp-divider)] bg-white hover:border-[var(--erp-text)]'
                    }`}
                  >
                    {isSelected ? (
                      <CheckCircleIcon
                        aria-hidden="true"
                        className="absolute right-3 top-3 h-5 w-5 text-[var(--erp-accent)]"
                      />
                    ) : null}
                    <span
                      className={`mb-2 text-2xl font-extrabold ${
                        isSelected ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'
                      }`}
                    >
                      {curr.symbol}
                    </span>
                    <span className="text-sm font-semibold text-[var(--erp-text)]">{curr.code}</span>
                    <span className="mt-0.5 text-left text-[12px] leading-snug text-[var(--erp-muted)]">
                      {curr.name}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </SettingsCard>

      <SettingsCard
        title="Печать чека"
        description="Когда печать выключена — после продажи ничего не печатается и не открывается окно «Сохранить как PDF»."
        actions={
          receiptPrintEnabled ? (
            <StatusBadge tone="ok">Печать включена</StatusBadge>
          ) : (
            <StatusBadge tone="idle">Печать отключена</StatusBadge>
          )
        }
      >
        <div className="max-w-[46rem] space-y-3">
          <SettingsToggle
            label="Печатать чек после продажи"
            description="Включите, когда подключён принтер."
            checked={receiptPrintEnabled}
            onChange={handleReceiptPrintToggle}
          />
          <p className="text-[12px] leading-snug text-[var(--erp-muted)]">
            Чтобы чек печатался сразу, без диалога и PDF: сделайте чековый принтер принтером
            по умолчанию в Windows и запускайте Chrome с флагом{' '}
            <code className="border border-[var(--erp-divider)] bg-[var(--erp-surface)] px-1 py-0.5 text-[11px] text-[var(--erp-text)]">
              --kiosk-printing
            </code>
            .
          </p>
        </div>
      </SettingsCard>
    </div>
  );
}
