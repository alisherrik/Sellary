'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { purchaseReportApi } from '@/lib/api';
import { windowStart } from '@/lib/reportWindow';
import { formatDateTime, formatIsoDate, formatMoney, formatUnitPrice } from '@/lib/utils';
import { CardSkeleton, TableSkeleton } from '@/components/skeletons';
import QueryError from '@/components/ui/QueryError';
import ReconciliationNotice from '@/components/ReconciliationNotice';
import type {
  OutstandingOrderRow,
  PurchaseByProductRow,
  PurchaseBySupplierRow,
  PurchaseSummary,
} from '@/lib/types';

const PERIODS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 365, label: 'Год' },
];

type Tab = 'products' | 'suppliers' | 'outstanding';

const TABS: { key: Tab; label: string }[] = [
  { key: 'products', label: 'По товарам' },
  { key: 'suppliers', label: 'По поставщикам' },
  { key: 'outstanding', label: 'Заказано, но не пришло' },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-[var(--erp-divider)] bg-white p-4 dark:bg-gray-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--erp-text)] dark:text-white">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-[var(--erp-muted)]">{hint}</p>}
    </div>
  );
}

/** Percent change in a buying price, coloured by which way it hurts. */
function CostChange({ percent }: { percent: string | null }) {
  if (percent === null) return <span className="text-[var(--erp-muted)]">—</span>;
  const value = Number(percent);
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) {
    return <span className="text-[var(--erp-muted)]">без изменений</span>;
  }
  // A rising purchase price is bad news for the shop, so it reads red.
  return (
    <span className={value > 0 ? 'text-[#dc2626]' : 'text-[var(--erp-success)]'}>
      {value > 0 ? '+' : '−'}
      {Math.abs(value).toFixed(1)} %
    </span>
  );
}

export default function PurchaseReportPage() {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>('products');
  const start_date = windowStart(days);

  const summary = useQuery<PurchaseSummary>({
    queryKey: ['purchase-report', 'summary', days],
    queryFn: async () => (await purchaseReportApi.summary({ days, start_date })).data,
  });

  const byProduct = useQuery<PurchaseByProductRow[]>({
    queryKey: ['purchase-report', 'by-product', days],
    queryFn: async () => (await purchaseReportApi.byProduct({ days, start_date, limit: 500 })).data,
    enabled: tab === 'products',
  });

  const bySupplier = useQuery<PurchaseBySupplierRow[]>({
    queryKey: ['purchase-report', 'by-supplier', days],
    queryFn: async () => (await purchaseReportApi.bySupplier({ days, start_date })).data,
    enabled: tab === 'suppliers',
  });

  const outstanding = useQuery<OutstandingOrderRow[]>({
    queryKey: ['purchase-report', 'outstanding'],
    queryFn: async () => (await purchaseReportApi.outstanding()).data,
    enabled: tab === 'outstanding',
  });

  return (
    <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">
            Отчёт по закупкам
          </h2>
          <p className="mt-0.5 max-w-[70ch] text-sm text-[var(--erp-muted)]">
            Что купили и почём. Считается по фактически принятому товару: пока заказ не
            принят на склад, он ничего не стоит — такие заказы вынесены в отдельную
            вкладку.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            {PERIODS.map((period) => (
              <button
                key={period.days}
                onClick={() => setDays(period.days)}
                className={`h-9 border px-3 text-sm font-medium ${
                  days === period.days
                    ? 'border-[var(--erp-accent)] bg-[var(--erp-accent)] text-white'
                    : 'border-[var(--erp-divider)] bg-white text-[var(--erp-text)] hover:border-[var(--erp-text)] dark:bg-gray-800 dark:text-gray-100'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
          {/* The window the SERVER used: a reconciliation floors a defaulted
              start, and the button then names a period nobody was shown. */}
          {summary.data?.period_start && summary.data?.period_end ? (
            <p className="text-xs tabular-nums text-[var(--erp-muted)]">
              {formatIsoDate(summary.data.period_start)} —{' '}
              {formatIsoDate(summary.data.period_end)}
            </p>
          ) : null}
        </div>
      </div>

      <ReconciliationNotice />

      {summary.isLoading ? (
        <CardSkeleton />
      ) : summary.isError ? (
        <QueryError what="отчёт" onRetry={() => void summary.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Потрачено на товар"
            value={formatMoney(summary.data!.total_spend)}
            hint={`${summary.data!.lines_count} позиций в ${summary.data!.receipts_count} поставках`}
          />
          <Stat
            label="Средняя поставка"
            value={formatMoney(summary.data!.average_receipt)}
            hint={`${summary.data!.orders_count} заказов`}
          />
          <Stat
            label="Наименований"
            value={String(summary.data!.products_count)}
            hint="разных товаров закуплено"
          />
          <Stat
            label="Поставщиков"
            value={String(summary.data!.suppliers_count)}
            hint="у скольких закупались"
          />
        </div>
      )}

      <div className="flex gap-1 border-b border-[var(--erp-divider)]">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`-mb-px h-10 border-b-2 px-4 text-sm font-medium ${
              tab === item.key
                ? 'border-[var(--erp-accent)] text-[var(--erp-text)] dark:text-white'
                : 'border-transparent text-[var(--erp-muted)] hover:text-[var(--erp-text)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'products' &&
        (byProduct.isLoading ? (
          <TableSkeleton />
        ) : byProduct.isError ? (
          <QueryError what="товары" onRetry={() => void byProduct.refetch()} />
        ) : (byProduct.data ?? []).length === 0 ? (
          <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
            За выбранный период товар не принимали.
          </div>
        ) : (
          <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                  <th className="px-4 py-3">Товар</th>
                  <th className="px-4 py-3 text-right">Куплено</th>
                  <th className="px-4 py-3 text-right">Потрачено</th>
                  <th className="px-4 py-3 text-right">Доля</th>
                  <th className="px-4 py-3 text-right">Средняя цена</th>
                  <th className="px-4 py-3 text-right">Было → стало</th>
                  <th className="px-4 py-3 text-right">Изменение</th>
                  <th className="px-4 py-3 text-right">Продаём по</th>
                  <th className="px-4 py-3 text-right">Поставок</th>
                </tr>
              </thead>
              <tbody>
                {(byProduct.data ?? []).map((row) => (
                  <tr
                    key={row.product_id}
                    className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                  >
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {Number(row.quantity)} {row.uom ?? ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(row.spend)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                      {Number(row.share_percent).toFixed(1)} %
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatUnitPrice(row.average_cost)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                      {row.first_cost !== null && row.last_cost !== null
                        ? `${formatUnitPrice(row.first_cost)} → ${formatUnitPrice(row.last_cost)}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      <CostChange percent={row.cost_change_percent} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                      {formatUnitPrice(row.current_sell_price)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                      {row.deliveries}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'suppliers' &&
        (bySupplier.isLoading ? (
          <TableSkeleton />
        ) : bySupplier.isError ? (
          <QueryError what="поставщиков" onRetry={() => void bySupplier.refetch()} />
        ) : (bySupplier.data ?? []).length === 0 ? (
          <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
            За выбранный период поставок не было.
          </div>
        ) : (
          <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                  <th className="px-4 py-3">Поставщик</th>
                  <th className="px-4 py-3 text-right">Потрачено</th>
                  <th className="px-4 py-3 text-right">Доля</th>
                  <th className="px-4 py-3 text-right">Поставок</th>
                  <th className="px-4 py-3 text-right">Наименований</th>
                  <th className="px-4 py-3 text-right">Последняя поставка</th>
                </tr>
              </thead>
              <tbody>
                {(bySupplier.data ?? []).map((row) => (
                  <tr
                    key={row.supplier_id}
                    className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                  >
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(row.spend)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--erp-muted)]">
                      {Number(row.share_percent).toFixed(1)} %
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.receipts}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.products}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-[var(--erp-muted)]">
                      {row.last_received_at ? formatDateTime(row.last_received_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'outstanding' &&
        (outstanding.isLoading ? (
          <TableSkeleton />
        ) : outstanding.isError ? (
          <QueryError what="заказы" onRetry={() => void outstanding.refetch()} />
        ) : (outstanding.data ?? []).length === 0 ? (
          <div className="border border-[var(--erp-divider)] bg-white p-4 text-sm text-[var(--erp-muted)] dark:bg-gray-800">
            Все отправленные заказы приняты полностью.
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--erp-muted)]">
              Эти суммы ещё не потрачены и в отчёт выше не входят — товар не принят.
            </p>
            <div className="overflow-x-auto border-2 border-[var(--erp-divider)] bg-white dark:bg-gray-800">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                    <th className="px-4 py-3">Заказ</th>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Поставщик</th>
                    <th className="px-4 py-3 text-right">Сумма заказа</th>
                    <th className="px-4 py-3 text-right">Позиций не пришло</th>
                  </tr>
                </thead>
                <tbody>
                  {(outstanding.data ?? []).map((row) => (
                    <tr
                      key={row.order_id}
                      className="border-t border-[var(--erp-divider)] hover:bg-[var(--erp-surface)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/purchase-orders/${row.order_id}`}
                          className="font-medium text-[var(--erp-accent)] hover:underline"
                        >
                          №{row.order_id}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                        {row.order_date ? formatDateTime(row.order_date) : '—'}
                      </td>
                      <td className="px-4 py-3">{row.supplier_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(row.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.pending_lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
    </div>
  );
}
