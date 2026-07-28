'use client';

import { formatMoney } from '@/lib/utils';
import type { CashShift, ShiftTotals } from '@/lib/types';

const CARD_LABELS: Record<string, string> = { dc: 'DC', eskhata: 'Эсхата', alif: 'Alif' };
const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  mobile: 'Мобильный',
  credit: 'В долг',
};

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

function Row({ label, hint, value, bold = false, tone, indent = false }: {
  label: string;
  hint?: string;
  value: string;
  bold?: boolean;
  tone?: 'short' | 'over' | 'muted';
  indent?: boolean;
}) {
  const toneClass =
    tone === 'short'
      ? 'text-[#dc2626]'
      : tone === 'over'
        ? 'text-[var(--erp-success)]'
        : tone === 'muted'
          ? 'text-[var(--erp-muted)]'
          : '';
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${indent ? 'pl-4' : ''}`}>
      <span className={`min-w-0 ${indent ? 'text-xs text-[var(--erp-muted)]' : 'text-gray-600'} ${bold ? 'font-semibold text-[var(--erp-text)]' : ''}`}>
        {label}
        {hint && <span className="ml-1.5 text-[11px] font-normal text-[var(--erp-muted)]">{hint}</span>}
      </span>
      <span
        className={`shrink-0 tabular-nums ${indent ? 'text-xs text-[var(--erp-muted)]' : ''} ${bold ? 'font-bold' : ''} ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">{children}</p>
      {note && <p className="mt-0.5 text-[11px] leading-snug text-[var(--erp-muted)]">{note}</p>}
    </div>
  );
}

/**
 * The payment-method breakdown for a shift, plus the cash reconciliation.
 * Shared by the open-shift block, a snapshot, and a closed shift's detail —
 * they all carry the same ShiftTotals shape.
 *
 * The panel spells out both sums instead of leaving them to be added by eye.
 * A cashier reading the old version added наличные + карта + оплата долга and
 * got more than the day's takings, because a debt repayment is cash arriving
 * against a sale booked in an earlier shift — it moves the drawer but is not
 * revenue, and «в долг» is the mirror case: revenue that never reached the
 * drawer. Neither line said so, and no total existed to check against.
 */
export function ShiftTotalsPanel({ shift, totals }: { shift: CashShift; totals: ShiftTotals }) {
  const cardEntries = Object.entries(totals.card_by_type || {}).filter(([, v]) => num(v) !== 0);
  const debtEntries = Object.entries(totals.debt_payments_by_method || {}).filter(([, v]) => num(v) !== 0);
  const refundEntries = Object.entries(totals.refunds_by_method || {}).filter(([, v]) => num(v) !== 0);
  const closed = shift.status === 'closed';
  const discrepancy = shift.discrepancy != null ? Number(shift.discrepancy) : null;

  const cashSales = num(totals.cash_sales);
  const cardSales = num(totals.card_sales);
  const mobileSales = num(totals.mobile_sales);
  const creditSales = num(totals.credit_sales);
  const revenue = cashSales + cardSales + mobileSales + creditSales;

  // Only cash touches the drawer. Card and mobile settle at the bank, and a
  // debt repayment by card never passes through the till either.
  const cashDebt = num(totals.debt_payments_by_method?.cash);
  const cashRefunds = num(totals.refunds_by_method?.cash);
  // The residual between this window's arithmetic and the drawer's own ledger.
  // Zero on a healthy shift; shown only when it isn't, so the lines above and
  // «Ожидается в кассе» never silently fail to add up.
  const lateArrivals = num(totals.late_arrivals);
  const openingCash = num(shift.opening_cash);
  const movements = totals.movements ?? [];
  const movementsIn = num(totals.movements_in);
  const movementsOut = num(totals.movements_out);

  return (
    <div className="space-y-4">
      <div className="border border-[var(--erp-divider)] bg-white p-4">
        <SectionTitle>Выручка по оплате</SectionTitle>
        <Row label={METHOD_LABELS.cash} value={formatMoney(cashSales)} />
        <Row label={METHOD_LABELS.card} value={formatMoney(cardSales)} />
        {cardEntries.map(([type, amount]) => (
          <Row key={type} indent label={CARD_LABELS[type] ?? type} value={formatMoney(amount)} />
        ))}
        {mobileSales !== 0 && <Row label={METHOD_LABELS.mobile} value={formatMoney(mobileSales)} />}
        <Row label={METHOD_LABELS.credit} hint="· деньги ещё не получены" value={formatMoney(creditSales)} />
        <div className="mt-1 border-t border-[var(--erp-divider)] pt-1">
          <Row label="Итого выручка" value={formatMoney(revenue)} bold />
          <Row label="Чеков" value={String(totals.sales_count)} tone="muted" />
        </div>
      </div>

      {(debtEntries.length > 0 || refundEntries.length > 0 || movements.length > 0) && (
        <div className="border border-[var(--erp-divider)] bg-white p-4">
          <SectionTitle note="Не входят в выручку смены: долг был продан раньше, возврат уменьшает прошлую продажу, а внесения и изъятия — это не торговля.">
            Прочие движения денег
          </SectionTitle>
          {debtEntries.map(([method, amount]) => (
            <Row
              key={`d-${method}`}
              label={`Оплата долга (${METHOD_LABELS[method] ?? method})`}
              value={`+${formatMoney(amount)}`}
            />
          ))}
          {refundEntries.map(([method, amount]) => (
            <Row
              key={`r-${method}`}
              label={`Возврат (${METHOD_LABELS[method] ?? method})`}
              value={`−${formatMoney(amount)}`}
            />
          ))}
          {movements.map((movement) => (
            <Row
              key={`m-${movement.id}`}
              label={movement.reason_label}
              hint={movement.note ?? undefined}
              value={`${movement.direction === 'in' ? '+' : '−'}${formatMoney(movement.amount)}`}
            />
          ))}
        </div>
      )}

      <div className="border border-[var(--erp-divider)] bg-white p-4">
        <SectionTitle note="Только наличные. Карта и «в долг» в ящик не попадают.">
          Касса (наличные)
        </SectionTitle>
        <Row label="На начало" value={formatMoney(openingCash)} />
        <Row label="Продажи наличными" value={`+${formatMoney(cashSales)}`} />
        {cashDebt !== 0 && <Row label="Оплата долга наличными" value={`+${formatMoney(cashDebt)}`} />}
        {cashRefunds !== 0 && <Row label="Возвраты наличными" value={`−${formatMoney(cashRefunds)}`} />}
        {movementsIn !== 0 && <Row label="Внесения в кассу" value={`+${formatMoney(movementsIn)}`} />}
        {movementsOut !== 0 && <Row label="Изъятия из кассы" value={`−${formatMoney(movementsOut)}`} />}
        {lateArrivals !== 0 && (
          <Row
            label="Из прошлых смен"
            hint="· уточнения по закрытым сменам — эти деньги уже в ящике"
            value={`${lateArrivals > 0 ? '+' : '−'}${formatMoney(Math.abs(lateArrivals))}`}
          />
        )}
        <div className="mt-1 border-t border-[var(--erp-divider)] pt-1">
          <Row label="Ожидается в кассе" value={formatMoney(totals.expected_cash)} bold />
        </div>
        {closed && (
          <>
            <Row label="Посчитано" value={formatMoney(shift.counted_cash ?? '0')} />
            <Row
              label={
                discrepancy != null && discrepancy < 0
                  ? 'Недостача'
                  : discrepancy != null && discrepancy > 0
                    ? 'Излишек'
                    : 'Расхождение'
              }
              value={formatMoney(shift.discrepancy ?? '0')}
              bold
              tone={discrepancy != null && discrepancy < 0 ? 'short' : discrepancy != null && discrepancy > 0 ? 'over' : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
