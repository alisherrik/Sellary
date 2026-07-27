'use client';

import { useMemo } from 'react';
import { TrashIcon, PlusIcon } from '@heroicons/react/24/outline';

export type SplitMethod = 'cash' | 'card' | 'mobile' | 'credit';
export type SplitCardType = 'alif' | 'eskhata' | 'dc';

export type SplitTender = {
  /** Stable across re-renders so React does not reorder inputs mid-typing. */
  key: string;
  method: SplitMethod;
  cardType: SplitCardType | null;
  /** Raw input text, not a number — the cashier is mid-typing most of the time. */
  amount: string;
};

const METHOD_LABELS: Record<SplitMethod, string> = {
  cash: 'Наличные',
  card: 'Карта',
  mobile: 'Мобильный',
  credit: 'В долг',
};

const CARD_LABELS: Record<SplitCardType, string> = {
  alif: 'Alif',
  eskhata: 'Eskhata',
  dc: 'DC',
};

export function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newTender(method: SplitMethod = 'cash'): SplitTender {
  return {
    key: `${method}-${Math.random().toString(36).slice(2, 9)}`,
    method,
    cardType: method === 'card' ? 'dc' : null,
    amount: '',
  };
}

export type SplitState = {
  tendered: number;
  remaining: number;
  /** Every tender adds up to the total and each line is usable. */
  isValid: boolean;
  hasCredit: boolean;
  problems: string[];
};

export function evaluateSplit(
  tenders: SplitTender[],
  total: number,
  hasCustomer: boolean,
): SplitState {
  const problems: string[] = [];
  const tendered = tenders.reduce((sum, t) => sum + parseAmount(t.amount), 0);
  // Compared in whole cents: 0.1 + 0.2 !== 0.3 in binary floating point, and a
  // checkout button that stays disabled on an exact payment is unusable.
  // The trailing `+ 0` folds -0 into 0, so an exact payment never renders as
  // "-0.00".
  const remaining = Math.round((total - tendered) * 100) / 100 + 0;
  const hasCredit = tenders.some((t) => t.method === 'credit');

  if (tenders.some((t) => parseAmount(t.amount) <= 0)) {
    problems.push('Каждая строка должна иметь сумму больше нуля.');
  }
  if (tenders.filter((t) => t.method === 'credit').length > 1) {
    problems.push('Долг можно указать только один раз.');
  }
  if (hasCredit && !hasCustomer) {
    problems.push('Для долга выберите клиента.');
  }
  if (tenders.some((t) => t.method === 'card' && !t.cardType)) {
    problems.push('Для оплаты картой выберите банк.');
  }
  if (remaining > 0) {
    problems.push(`Не внесено ещё ${remaining.toFixed(2)}.`);
  }
  if (remaining < 0) {
    problems.push(`Внесено на ${Math.abs(remaining).toFixed(2)} больше суммы.`);
  }

  return {
    tendered,
    remaining,
    hasCredit,
    isValid: tenders.length > 0 && problems.length === 0,
    problems,
  };
}

/** The request shape the API expects. Amounts are fixed to two decimals here
 *  because the server rejects a split that does not add up to the cent. */
export function toPaymentsPayload(tenders: SplitTender[]) {
  return tenders.map((tender) => ({
    method: tender.method,
    ...(tender.method === 'card' ? { card_type: tender.cardType } : {}),
    amount: parseAmount(tender.amount).toFixed(2),
  }));
}

type Props = {
  tenders: SplitTender[];
  onChange: (tenders: SplitTender[]) => void;
  total: number;
  state: SplitState;
};

export default function SplitPaymentPanel({ tenders, onChange, total, state }: Props) {
  const remainingLabel = useMemo(() => {
    if (state.remaining > 0) return 'Осталось внести';
    if (state.remaining < 0) return 'Излишек';
    return 'Оплачено полностью';
  }, [state.remaining]);

  const update = (key: string, patch: Partial<SplitTender>) =>
    onChange(tenders.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const remove = (key: string) => onChange(tenders.filter((t) => t.key !== key));

  const add = () => {
    // Pre-fill with what is still owed: the common case is two tenders, and
    // the second one is always "the rest".
    const rest = state.remaining > 0 ? state.remaining.toFixed(2) : '';
    onChange([...tenders, { ...newTender('cash'), amount: rest }]);
  };

  return (
    <div className="mb-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-700 sm:mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 sm:text-sm">
          Способы оплаты
        </span>
        <span className="text-xs text-gray-500">К оплате {total.toFixed(2)}</span>
      </div>

      <div className="space-y-2">
        {tenders.map((tender) => (
          <div key={tender.key} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Способ оплаты"
              value={tender.method}
              onChange={(event) => {
                const method = event.target.value as SplitMethod;
                update(tender.key, {
                  method,
                  cardType: method === 'card' ? (tender.cardType ?? 'dc') : null,
                });
              }}
              className="h-11 min-w-[8rem] flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            >
              {(Object.keys(METHOD_LABELS) as SplitMethod[]).map((method) => (
                <option key={method} value={method}>
                  {METHOD_LABELS[method]}
                </option>
              ))}
            </select>

            {tender.method === 'card' && (
              <select
                aria-label="Банк"
                value={tender.cardType ?? 'dc'}
                onChange={(event) =>
                  update(tender.key, { cardType: event.target.value as SplitCardType })
                }
                className="h-11 min-w-[7rem] rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                {(Object.keys(CARD_LABELS) as SplitCardType[]).map((card) => (
                  <option key={card} value={card}>
                    {CARD_LABELS[card]}
                  </option>
                ))}
              </select>
            )}

            <input
              aria-label="Сумма"
              type="text"
              inputMode="decimal"
              value={tender.amount}
              onChange={(event) => update(tender.key, { amount: event.target.value })}
              placeholder="0.00"
              className="h-11 w-28 rounded-xl border border-gray-300 bg-white px-3 text-right text-base font-bold tabular-nums text-gray-900 outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />

            <button
              type="button"
              aria-label="Удалить строку"
              onClick={() => remove(tender.key)}
              disabled={tenders.length === 1}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-40 dark:border-gray-600"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold text-gray-600 transition hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-300"
      >
        <PlusIcon className="h-5 w-5" />
        Добавить способ оплаты
      </button>

      <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-700">
        <span className="text-sm text-gray-600 dark:text-gray-300">{remainingLabel}</span>
        <span
          className={`text-lg font-bold tabular-nums ${
            state.remaining === 0
              ? 'text-[var(--erp-success)]'
              : 'text-[var(--erp-danger,#dc2626)]'
          }`}
        >
          {Math.abs(state.remaining).toFixed(2)}
        </span>
      </div>

      {state.problems.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-[var(--erp-danger,#dc2626)]">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
