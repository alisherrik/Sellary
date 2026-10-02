'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { reconciliationApi } from '@/lib/api';
import { formatIsoDate, formatMoney } from '@/lib/utils';
import { CardSkeleton } from '@/components/skeletons';
import QueryError from '@/components/ui/QueryError';
import { ModuleGuard } from '@/components/ModuleGuard';
import type { PeriodDetail, PeriodList, PeriodRow } from '@/lib/types';

/** «01.06 — 30.06.2026», or «до 30.04.2026» when the period has no start. */
function periodLabel(row: Pick<PeriodRow, 'start_day' | 'end_day'>) {
  if (!row.start_day) return `до ${formatIsoDate(row.end_day)}`;
  return `${formatIsoDate(row.start_day)} — ${formatIsoDate(row.end_day)}`;
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-[var(--erp-divider)] bg-white p-3 dark:bg-gray-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums text-[var(--erp-text)] dark:text-white">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-[var(--erp-muted)]">{hint}</p>}
    </div>
  );
}

function Detail({ id }: { id: number }) {
  const detail = useQuery<PeriodDetail>({
    queryKey: ['reconciliation', 'period', id],
    queryFn: async () => (await reconciliationApi.period(id)).data,
  });

  if (detail.isLoading) return <CardSkeleton />;
  if (detail.isError) {
    return <QueryError what="период" onRetry={() => void detail.refetch()} />;
  }

  const data = detail.data!;

  return (
    <div className="space-y-3 border-t border-[var(--erp-divider)] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Закуплено"
          value={formatMoney(data.purchased)}
          hint={`${data.receipts_count} поставок`}
        />
        <Figure
          label="Продано"
          value={formatMoney(data.sold)}
          hint={`${data.sales_count} чеков, за вычетом возвратов`}
        />
        <Figure label="Себестоимость" value={formatMoney(data.cost)} />
        <Figure
          label="Прибыль"
          value={formatMoney(data.profit)}
          hint={`после списаний ${formatMoney(data.profit_after_write_offs)}`}
        />
        <Figure label="Списания" value={formatMoney(data.write_off_cost)} />
        <Figure
          label="Возвраты"
          value={formatMoney(data.returns_total)}
          hint="уже вычтены из «Продано»"
        />
      </div>

      {data.late_arrivals.count > 0 && (
        <div
          role="status"
          className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-3 text-[13px] leading-snug"
        >
          {data.late_arrivals.count} чека на {formatMoney(data.late_arrivals.total)} пришли
          с кассы после закрытия периода. Они посчитаны своей датой, поэтому цифры выше
          отличаются от тех, что были в день сверки.
        </div>
      )}

      {data.checker_report && data.checker_report.length > 0 && (
        <div className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-3 text-[13px] leading-snug">
          При сверке были зафиксированы расхождения — период закрыт с ними.
        </div>
      )}

      <p className="text-xs text-[var(--erp-muted)]">
        Сверка от {formatIsoDate(data.effective_from)}
        {data.declared_by ? `, провёл ${data.declared_by}` : ''}.
      </p>
    </div>
  );
}

const PAGE_SIZE = 12;

function Periods() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const list = useQuery<PeriodList>({
    queryKey: ['reconciliation', 'periods', visibleCount],
    queryFn: async () => (await reconciliationApi.periods({ limit: visibleCount })).data,
  });

  return (
    <div className="h-full space-y-4 overflow-y-auto mobile-no-overscroll p-4">
      <div>
        <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">
          Периоды
        </h2>
        <p className="mt-0.5 max-w-[70ch] text-sm text-[var(--erp-muted)]">
          Каждая сверка закрывает период. Здесь видно, сколько за этот период купили и
          сколько продали. Цифры считаются заново при каждом открытии, поэтому они всегда
          совпадают с остальными отчётами.
        </p>
      </div>

      {list.isLoading ? (
        <CardSkeleton />
      ) : list.isError ? (
        <QueryError what="периоды" onRetry={() => void list.refetch()} />
      ) : list.data!.periods.length === 0 ? (
        <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
          Сверок ещё не было. Периоды появятся после первой сверки — её проводят в
          Настройках.
        </div>
      ) : (
        <div className="space-y-2">
          {list.data!.periods.map((row) => (
            <div key={row.id} className="border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
              <button
                onClick={() => setOpenId(openId === row.id ? null : row.id)}
                aria-expanded={openId === row.id}
                className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 p-4 text-left hover:bg-[var(--erp-surface)]"
              >
                <span className="font-semibold text-[var(--erp-text)]">
                  {periodLabel(row)}
                </span>
                <span className="text-xs text-[var(--erp-muted)]">Сверка №{row.index}</span>
                <span className="ml-auto text-sm tabular-nums">
                  Куплено{' '}
                  <b className="font-semibold">{formatMoney(row.purchased)}</b>
                </span>
                <span className="text-sm tabular-nums">
                  Продано <b className="font-semibold">{formatMoney(row.sold)}</b>
                </span>
              </button>
              {openId === row.id && <Detail id={row.id} />}
            </div>
          ))}
          {list.data!.periods.length < list.data!.total && (
            <button
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              disabled={list.isFetching}
              className="w-full border-2 border-[var(--erp-divider)] bg-white p-3 text-sm font-medium text-[var(--erp-accent)] hover:bg-[var(--erp-surface)] disabled:opacity-50 dark:bg-gray-800"
            >
              Показать ещё
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function PeriodsPage() {
  return (
    <ModuleGuard module="reports">
      <Periods />
    </ModuleGuard>
  );
}
