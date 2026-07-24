'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';

import FilterMenu from '@/components/filters/FilterMenu';
import PurchaseOrderStatusBadge from '@/components/purchase-orders/PurchaseOrderStatusBadge';
import { TableSkeleton } from '@/components/skeletons';
import { usePurchaseOrders, useSuppliers } from '@/hooks/useQueries';
import type { PurchaseOrderStatus } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

const statusOptions: Array<{ value: PurchaseOrderStatus | ''; label: string }> = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновик' },
  { value: 'sent', label: 'Отправлен' },
  { value: 'partially_received', label: 'Частично получен' },
  { value: 'received', label: 'Получен' },
  { value: 'cancelled', label: 'Отменён' },
];

const getPrimaryAction = (status: PurchaseOrderStatus) => {
  if (status === 'draft') return 'Продолжить';
  if (status === 'sent' || status === 'partially_received') return 'Принять';
  return 'Открыть';
};

export default function PurchaseOrdersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const params: Record<string, string | number> = { limit: 200 };
  if (statusFilter) params.status = statusFilter;
  if (supplierFilter) params.supplier_id = Number(supplierFilter);
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;

  const ordersQuery = usePurchaseOrders(params);
  const suppliersQuery = useSuppliers({ limit: 200 });
  const purchaseOrders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const suppliers = suppliersQuery.data ?? [];

  const visibleOrders = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('ru-RU');
    if (!query) return purchaseOrders;
    return purchaseOrders.filter(
      (order) =>
        String(order.id).includes(query) ||
        order.supplier?.name.toLocaleLowerCase('ru-RU').includes(query),
    );
  }, [purchaseOrders, searchQuery]);

  const hasFilters = Boolean(searchQuery || statusFilter || supplierFilter || startDate || endDate);
  const activeFilterCount =
    (statusFilter ? 1 : 0) + (supplierFilter ? 1 : 0) + (startDate ? 1 : 0) + (endDate ? 1 : 0);
  const resetAdvancedFilters = () => {
    setStatusFilter('');
    setSupplierFilter('');
    setStartDate('');
    setEndDate('');
  };
  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setSupplierFilter('');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Заказы поставщикам</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">Создание и приёмка</p>
        </div>
        <Link
          href="/purchase-orders/new"
          className="ml-auto inline-flex h-[38px] items-center gap-2 bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--erp-accent)] focus-visible:ring-offset-2"
        >
          <PlusIcon className="h-5 w-5" />
          Создать закупку
        </Link>
      </header>

      <section aria-label="Поиск и фильтры закупок" className="mt-6 border-y border-[var(--erp-divider)] bg-white py-4">
        <div className="flex items-center gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Поиск закупок</span>
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Поиск закупок"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Номер заказа или поставщик"
              className="min-h-11 w-full border border-[var(--erp-divider)] bg-white py-2 pl-9 pr-3 text-sm focus:border-[var(--erp-text)] focus:outline-none"
            />
          </label>

          <FilterMenu activeCount={activeFilterCount} onReset={resetAdvancedFilters}>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Статус
                </span>
                <select
                  aria-label="Статус закупки"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as PurchaseOrderStatus | '')
                  }
                  className="min-h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus:border-[var(--erp-text)] focus:outline-none"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Поставщик
                </span>
                <select
                  aria-label="Поставщик"
                  value={supplierFilter}
                  onChange={(event) => setSupplierFilter(event.target.value)}
                  className="min-h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus:border-[var(--erp-text)] focus:outline-none"
                >
                  <option value="">Все поставщики</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Дата от
                  </span>
                  <input
                    type="date"
                    aria-label="Дата от"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="min-h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus:border-[var(--erp-text)] focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Дата до
                  </span>
                  <input
                    type="date"
                    aria-label="Дата до"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="min-h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus:border-[var(--erp-text)] focus:outline-none"
                  />
                </label>
              </div>

              <p className="text-xs tabular-nums text-gray-500">
                Показано: {visibleOrders.length} из {purchaseOrders.length}
              </p>
            </div>
          </FilterMenu>
        </div>
      </section>

      <section className="mt-5 overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
        {ordersQuery.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={6} columns={6} />
          </div>
        ) : ordersQuery.isError ? (
          <div role="alert" className="p-8 text-center">
            <h2 className="font-semibold text-[var(--erp-text)]">Не удалось загрузить закупки</h2>
            <p className="mt-1 text-sm text-gray-500">Обновите страницу и попробуйте снова.</p>
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="p-10 text-center">
            <h2 className="font-semibold text-[var(--erp-text)]">
              {hasFilters ? 'Закупки не найдены' : 'Закупок пока нет'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {hasFilters
                ? 'Измените запрос или сбросьте фильтры.'
                : 'Создайте первый заказ поставщику.'}
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 min-h-11 px-4 text-sm font-semibold text-[var(--erp-accent)] hover:bg-[var(--erp-surface)]"
              >
                Сбросить фильтры
              </button>
            ) : (
              <Link
                href="/purchase-orders/new"
                className="mt-4 inline-flex min-h-11 items-center bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:opacity-90"
              >
                Создать закупку
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--erp-divider)] sm:hidden">
              {visibleOrders.map((order) => (
                <article key={order.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={'/purchase-orders/' + order.id}
                        className="font-bold text-[var(--erp-text)] hover:text-[var(--erp-accent)]"
                      >
                        #{order.id}
                      </Link>
                      <p className="mt-1 truncate text-sm text-gray-600">
                        {order.supplier?.name ?? 'Поставщик не указан'}
                      </p>
                    </div>
                    <PurchaseOrderStatusBadge status={order.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-gray-500">Дата</dt>
                      <dd className="mt-1 text-gray-800">{formatDate(order.order_date)}</dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-xs text-gray-500">Сумма</dt>
                      <dd className="mt-1 font-bold tabular-nums text-[var(--erp-text)]">
                        {formatCurrency(order.total_amount)}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={'/purchase-orders/' + order.id}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center border border-[var(--erp-divider)] bg-white px-4 text-sm font-semibold text-[var(--erp-text)] hover:border-[var(--erp-text)]"
                  >
                    {getPrimaryAction(order.status)}
                  </Link>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--erp-divider)] text-left text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-3">№</th>
                    <th className="px-4 py-3">Поставщик</th>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3 text-right">Сумма</th>
                    <th className="px-4 py-3 text-right">Следующий шаг</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--erp-divider)]">
                  {visibleOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-[var(--erp-surface)]">
                      <td className="px-4 py-4">
                        <Link
                          href={'/purchase-orders/' + order.id}
                          className="font-bold text-[var(--erp-text)] hover:text-[var(--erp-accent)]"
                        >
                          #{order.id}
                        </Link>
                      </td>
                      <td className="px-4 py-4 text-gray-700">
                        {order.supplier?.name ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-gray-600">
                        {formatDate(order.order_date)}
                      </td>
                      <td className="px-4 py-4">
                        <PurchaseOrderStatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-4 text-right font-bold tabular-nums text-[var(--erp-text)]">
                        {formatCurrency(order.total_amount)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={'/purchase-orders/' + order.id}
                          className="inline-flex min-h-9 items-center px-3 text-sm font-semibold text-[var(--erp-accent)] hover:bg-[var(--erp-surface)]"
                        >
                          {getPrimaryAction(order.status)}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {!ordersQuery.isLoading && visibleOrders.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          Показано: {visibleOrders.length} из {purchaseOrders.length}
        </p>
      )}
    </div>
  );
}
