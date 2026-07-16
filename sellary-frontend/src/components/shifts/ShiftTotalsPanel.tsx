'use client';

import { formatCurrency } from '@/lib/utils';
import type { CashShift, ShiftTotals } from '@/lib/types';

const CARD_LABELS: Record<string, string> = { dc: 'DC', eskhata: 'Эсхата', alif: 'Alif' };
const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  mobile: 'Мобильный',
  credit: 'В долг',
};

function Row({ label, value, bold = false, tone }: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'short' | 'over';
}) {
  const toneClass =
    tone === 'short' ? 'text-red-600' : tone === 'over' ? 'text-emerald-600' : '';
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={`text-gray-600 dark:text-gray-300 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : ''} ${toneClass}`}>{value}</span>
    </div>
  );
}

/**
 * The payment-method breakdown for a shift, plus the cash reconciliation.
 * Shared by the open-shift block, a snapshot, and a closed shift's detail —
 * they all carry the same ShiftTotals shape.
 */
export function ShiftTotalsPanel({ shift, totals }: { shift: CashShift; totals: ShiftTotals }) {
  const cardEntries = Object.entries(totals.card_by_type || {}).filter(([, v]) => Number(v) !== 0);
  const debtEntries = Object.entries(totals.debt_payments_by_method || {}).filter(([, v]) => Number(v) !== 0);
  const refundEntries = Object.entries(totals.refunds_by_method || {}).filter(([, v]) => Number(v) !== 0);
  const closed = shift.status === 'closed';
  const discrepancy = shift.discrepancy != null ? Number(shift.discrepancy) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Выручка по оплате</p>
        <Row label={METHOD_LABELS.cash} value={formatCurrency(totals.cash_sales)} />
        <Row label={METHOD_LABELS.card} value={formatCurrency(totals.card_sales)} />
        {cardEntries.map(([type, amount]) => (
          <div key={type} className="flex items-center justify-between py-0.5 pl-4 text-xs text-gray-400">
            <span>{CARD_LABELS[type] ?? type}</span>
            <span className="tabular-nums">{formatCurrency(amount)}</span>
          </div>
        ))}
        {Number(totals.mobile_sales) !== 0 && (
          <Row label={METHOD_LABELS.mobile} value={formatCurrency(totals.mobile_sales)} />
        )}
        <Row label={METHOD_LABELS.credit} value={formatCurrency(totals.credit_sales)} />
        <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-700">
          <Row label="Чеков" value={String(totals.sales_count)} />
        </div>
      </div>

      {(debtEntries.length > 0 || refundEntries.length > 0) && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Прочие движения</p>
          {debtEntries.map(([method, amount]) => (
            <Row key={`d-${method}`} label={`Оплата долга (${METHOD_LABELS[method] ?? method})`} value={`+${formatCurrency(amount)}`} />
          ))}
          {refundEntries.map(([method, amount]) => (
            <Row key={`r-${method}`} label={`Возврат (${METHOD_LABELS[method] ?? method})`} value={`−${formatCurrency(amount)}`} />
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Касса (наличные)</p>
        <Row label="На начало" value={formatCurrency(shift.opening_cash)} />
        <Row label="Ожидается в кассе" value={formatCurrency(totals.expected_cash)} bold />
        {closed && (
          <>
            <Row label="Посчитано" value={formatCurrency(shift.counted_cash ?? '0')} />
            <Row
              label={
                discrepancy != null && discrepancy < 0
                  ? 'Недостача'
                  : discrepancy != null && discrepancy > 0
                    ? 'Излишек'
                    : 'Расхождение'
              }
              value={formatCurrency(shift.discrepancy ?? '0')}
              bold
              tone={discrepancy != null && discrepancy < 0 ? 'short' : discrepancy != null && discrepancy > 0 ? 'over' : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
