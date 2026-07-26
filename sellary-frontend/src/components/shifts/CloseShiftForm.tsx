'use client';

import { useMemo, useState } from 'react';

import { formatMoney } from '@/lib/utils';
import type { CashShift, ShiftTotals } from '@/lib/types';

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const CENT = 0.005;

/**
 * Closing a shift: the cashier counts the drawer and the count is compared
 * with what the till should hold.
 *
 * The form used to put the expected figure in the input's placeholder. Every
 * close in production then matched an arithmetic expression of what the screen
 * already showed — three of five were «Ожидается» + the card takings, the rest
 * were «Ожидается» exactly. Nobody was counting; they were copying, and the
 * shift check had become a formality that could never surface a shortfall.
 *
 * So: no answer is shown before the cashier commits to a number. Once typed,
 * the arithmetic appears in full, and the two mistakes that produce a
 * suspiciously round result — adding card takings, adding credit sales — are
 * named explicitly rather than left as an unexplained «Излишек».
 */
export function CloseShiftForm({
  shift,
  totals,
  submitting,
  onCancel,
  onConfirm,
}: {
  shift: CashShift;
  totals: ShiftTotals;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (countedCash: string) => void;
}) {
  const [countedCash, setCountedCash] = useState('');

  const expected = num(totals.expected_cash);
  const card = num(totals.card_sales);
  const mobile = num(totals.mobile_sales);
  const credit = num(totals.credit_sales);

  const entered = countedCash.trim() === '' ? null : Number(countedCash);
  const hasNumber = entered !== null && Number.isFinite(entered);
  const difference = hasNumber ? entered - expected : 0;

  const mistake = useMemo(() => {
    if (!hasNumber || Math.abs(difference) < CENT) {
      return null;
    }
    // The difference lands exactly on a figure that is not in the drawer.
    const suspects: Array<[number, string]> = [
      [card, 'выручку по карте'],
      [mobile, 'выручку по мобильной оплате'],
      [credit, 'продажи в долг'],
      [card + mobile, 'выручку по карте и мобильной оплате'],
      [card + credit, 'выручку по карте и продажи в долг'],
    ];
    const hit = suspects.find(([value]) => value > 0 && Math.abs(difference - value) < CENT);
    return hit ? { amount: hit[0], what: hit[1] } : null;
  }, [hasNumber, difference, card, mobile, credit]);

  return (
    <div className="mt-3 border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-4">
      <p className="text-sm font-semibold text-[var(--erp-text)]">Закрытие смены</p>
      <p className="mt-1 text-xs leading-snug text-[var(--erp-muted)]">
        Пересчитайте деньги в ящике и введите то, что насчитали. В ящике только
        наличные: оплата картой уходит в банк, а «в долг» ещё не получена —
        добавлять их не нужно.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label
            htmlFor="counted-cash"
            className="mb-1 block text-xs font-medium text-[var(--erp-text)]"
          >
            Посчитанные наличные в кассе
          </label>
          <input
            id="counted-cash"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
            value={countedCash}
            onChange={(event) => setCountedCash(event.target.value)}
            // Deliberately no placeholder: it used to hold the expected figure,
            // which is the answer the count is supposed to check.
            className="h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm tabular-nums"
          />
        </div>
        <button
          type="button"
          onClick={() => onConfirm(countedCash)}
          disabled={submitting || !hasNumber}
          className="h-11 shrink-0 bg-[var(--erp-accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? 'Закрываем…' : 'Подтвердить закрытие'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-11 shrink-0 border border-[var(--erp-divider)] bg-white px-4 text-sm font-medium text-[var(--erp-text)] hover:border-[var(--erp-text)] disabled:opacity-60"
        >
          Отмена
        </button>
      </div>

      {hasNumber && (
        <div className="mt-3 border-t border-[var(--erp-divider)] pt-2">
          <div className="flex items-baseline justify-between py-0.5 text-sm">
            <span className="text-gray-600">Ожидается в кассе</span>
            <span className="tabular-nums">{formatMoney(expected)}</span>
          </div>
          <div className="flex items-baseline justify-between py-0.5 text-sm">
            <span className="text-gray-600">Вы насчитали</span>
            <span className="tabular-nums">{formatMoney(entered)}</span>
          </div>
          <div className="flex items-baseline justify-between py-0.5 text-sm font-semibold">
            <span className="text-[var(--erp-text)]">
              {difference < -CENT ? 'Недостача' : difference > CENT ? 'Излишек' : 'Расхождение'}
            </span>
            <span
              className={`tabular-nums ${
                difference < -CENT
                  ? 'text-[#dc2626]'
                  : difference > CENT
                    ? 'text-[var(--erp-success)]'
                    : ''
              }`}
            >
              {formatMoney(difference)}
            </span>
          </div>
        </div>
      )}

      {mistake && (
        <div
          role="alert"
          className="mt-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p className="font-semibold">Похоже, в счёт попали безналичные деньги</p>
          <p className="mt-1 leading-snug">
            Разница ровно {formatMoney(mistake.amount)} — это {mistake.what} за смену.
            Этих денег в ящике нет. Введите только то, что физически лежит в кассе.
          </p>
        </div>
      )}

      {(card !== 0 || mobile !== 0 || credit !== 0) && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--erp-muted)]">
          Не в кассе за эту смену:
          {card !== 0 && ` карта ${formatMoney(card)}`}
          {mobile !== 0 && ` · мобильный ${formatMoney(mobile)}`}
          {credit !== 0 && ` · в долг ${formatMoney(credit)}`}
        </p>
      )}
    </div>
  );
}
