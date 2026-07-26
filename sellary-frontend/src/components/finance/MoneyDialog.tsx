'use client';

import { useMemo, useRef, useState } from 'react';

import { useDialogFocus } from '@/hooks/useDialogFocus';
import { formatMoney } from '@/lib/utils';
import type { MoneyAccount, MovementReasons } from '@/lib/types';

export type MoneyDialogMode = 'in' | 'out' | 'transfer' | 'correct';

const TITLES: Record<MoneyDialogMode, string> = {
  in: 'Внести деньги',
  out: 'Изъять деньги',
  transfer: 'Перевод между счетами',
  correct: 'Скорректировать остаток',
};

const HINTS: Record<MoneyDialogMode, string> = {
  in: 'Деньги, которые пришли на счёт не от продажи: размен, внесение владельца, снятие с банка.',
  out: 'Деньги, которые ушли со счёта: сдача в банк, оплата поставщику, расходы, зарплата.',
  transfer:
    'Деньги никуда не пропадают и не появляются — они переходят с одного счёта на другой. Снятие выручки по карте наличными это перевод из банка в кассу.',
  correct:
    'Введите, сколько на счёте на самом деле. Разница запишется отдельным движением, и в истории будет видно, что и когда исправили.',
};

const field =
  'h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-900';

export function MoneyDialog({
  mode,
  accounts,
  reasons,
  defaultAccountId,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  mode: MoneyDialogMode;
  accounts: MoneyAccount[];
  reasons: MovementReasons | undefined;
  defaultAccountId?: number;
  submitting: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    mode: MoneyDialogMode;
    accountId: number;
    toAccountId?: number;
    amount: string;
    reason?: string;
    note?: string;
  }) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, true, onClose);

  const usable = accounts.filter((a) => a.is_active);
  const [accountId, setAccountId] = useState<number>(defaultAccountId ?? usable[0]?.id ?? 0);
  const [toAccountId, setToAccountId] = useState<number>(
    usable.find((a) => a.id !== (defaultAccountId ?? usable[0]?.id))?.id ?? 0,
  );
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const reasonList = mode === 'in' ? reasons?.in : reasons?.out;
  const [reason, setReason] = useState('');
  const effectiveReason = reason || reasonList?.[0]?.value || '';

  const account = usable.find((a) => a.id === accountId);
  const target = usable.find((a) => a.id === toAccountId);
  const numeric = amount.trim() === '' ? null : Number(amount);
  const valid = numeric !== null && Number.isFinite(numeric) && (mode === 'correct' || numeric > 0);

  // Shown while typing so the consequence is visible before committing, not
  // discovered afterwards in a balance that moved unexpectedly.
  const preview = useMemo(() => {
    if (!account || numeric === null || !Number.isFinite(numeric)) return null;
    const current = Number(account.balance);
    if (mode === 'in') return { label: account.name, from: current, to: current + numeric };
    if (mode === 'out') return { label: account.name, from: current, to: current - numeric };
    if (mode === 'correct') return { label: account.name, from: current, to: numeric };
    return { label: account.name, from: current, to: current - numeric };
  }, [account, numeric, mode]);

  const targetPreview = useMemo(() => {
    if (mode !== 'transfer' || !target || numeric === null || !Number.isFinite(numeric)) return null;
    const current = Number(target.balance);
    return { label: target.name, from: current, to: current + numeric };
  }, [mode, target, numeric]);

  const sameAccount = mode === 'transfer' && accountId === toAccountId;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="money-dialog-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto border border-[var(--erp-divider)] bg-white p-5 dark:bg-gray-800"
      >
        <h2
          id="money-dialog-title"
          className="text-lg font-bold tracking-tight text-[var(--erp-text)] dark:text-white"
        >
          {TITLES[mode]}
        </h2>
        <p className="mt-1 text-xs leading-snug text-[var(--erp-muted)]">{HINTS[mode]}</p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--erp-text)] dark:text-gray-200">
              {mode === 'transfer' ? 'Откуда' : 'Счёт'}
            </span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(Number(event.target.value))}
              className={field}
            >
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {formatMoney(a.balance)}
                </option>
              ))}
            </select>
          </label>

          {mode === 'transfer' && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--erp-text)] dark:text-gray-200">
                Куда
              </span>
              <select
                value={toAccountId}
                onChange={(event) => setToAccountId(Number(event.target.value))}
                className={field}
              >
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatMoney(a.balance)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--erp-text)] dark:text-gray-200">
              {mode === 'correct' ? 'Сколько на счёте на самом деле' : 'Сумма'}
            </span>
            <input
              type="number"
              min={mode === 'correct' ? '0' : '0.01'}
              step="0.01"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={field}
            />
          </label>

          {(mode === 'in' || mode === 'out') && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--erp-text)] dark:text-gray-200">
                Причина
              </span>
              <select
                value={effectiveReason}
                onChange={(event) => setReason(event.target.value)}
                className={field}
              >
                {(reasonList ?? []).map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--erp-text)] dark:text-gray-200">
              Комментарий
            </span>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Например: оплата за хлеб"
              className={`${field} tabular-nums-none`}
            />
          </label>
        </div>

        {preview && !sameAccount && (
          <div className="mt-4 border-t border-[var(--erp-divider)] pt-3 text-sm">
            <div className="flex items-baseline justify-between py-0.5">
              <span className="text-gray-600 dark:text-gray-300">{preview.label}</span>
              <span className="tabular-nums">
                {formatMoney(preview.from)} → <strong>{formatMoney(preview.to)}</strong>
              </span>
            </div>
            {targetPreview && (
              <div className="flex items-baseline justify-between py-0.5">
                <span className="text-gray-600 dark:text-gray-300">{targetPreview.label}</span>
                <span className="tabular-nums">
                  {formatMoney(targetPreview.from)} → <strong>{formatMoney(targetPreview.to)}</strong>
                </span>
              </div>
            )}
          </div>
        )}

        {sameAccount && (
          <p role="alert" className="mt-3 text-sm text-[#dc2626]">
            Счёт списания и счёт зачисления совпадают.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-11 border border-[var(--erp-divider)] bg-white px-4 text-sm font-medium text-[var(--erp-text)] hover:border-[var(--erp-text)] disabled:opacity-60 dark:bg-gray-800 dark:text-gray-100"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!valid || sameAccount || submitting}
            onClick={() =>
              onSubmit({
                mode,
                accountId,
                toAccountId: mode === 'transfer' ? toAccountId : undefined,
                amount: String(numeric),
                reason: mode === 'in' || mode === 'out' ? effectiveReason : undefined,
                note: note.trim() || undefined,
              })
            }
            className="h-11 bg-[var(--erp-accent)] px-5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Записываем…' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
  );
}
