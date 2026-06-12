'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';

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

  const params: Record<string, string | number> = { limit: 200 };
  if (statusFilter) params.status = statusFilter;
  if (supplierFilter) params.supplier_id = Number(supplierFilter);

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

  const hasFilters = Boolean(searchQuery || statusFilter || supplierFilter);
  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setSupplierFilter('');
  };

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Закупки</h1>
          <p className="mt-1 text-sm text-gray-500">
            Создавайте заказы поставщикам и контролируйте приёмку товара.
          </p>
        </div>
        <Link
          href="/purchase-orders/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <PlusIcon className="h-5 w-5" />
          Создать закупку
        </Link>
      </header>

      <section aria-label="Фильтры закупок" className="mt-6 border-y border-gray-200 bg-white py-4">
        <div className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_200px_220px]">
          <label className="relative block">
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
              className="min-h-11 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </label>

          <label>
            <span className="sr-only">Статус закупки</span>
            <select
              aria-label="Статус закупки"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as PurchaseOrderStatus | '')
              }
              className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            >
              {statusOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">Поставщик</span>
            <select
              aria-label="Поставщик"
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            >
              <option value="">Все поставщики</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="mt-5 overflow-hidden border-y border-gray-200 bg-white">
        {ordersQuery.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={6} columns={6} />
          </div>
        ) : ordersQuery.isError ? (
          <div role="alert" className="p-8 text-center">
            <h2 className="font-semibold text-gray-900">Не удалось загрузить закупки</h2>
            <p className="mt-1 text-sm text-gray-500">Обновите страницу и попробуйте снова.</p>
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="p-10 text-center">
            <h2 className="font-semibold text-gray-900">
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
                className="mt-4 min-h-11 rounded-md px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                Сбросить фильтры
              </button>
            ) : (
              <Link
                href="/purchase-orders/new"
                className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white"
              >
                Создать закупку
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-200 sm:hidden">
              {visibleOrders.map((order) => (
                <article key={order.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={'/purchase-orders/' + order.id}
                        className="font-bold text-gray-900 hover:text-blue-700"
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
                      <dd className="mt-1 font-bold tabular-nums text-blue-600">
                        {formatCurrency(order.total_amount)}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={'/purchase-orders/' + order.id}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700"
                  >
                    {getPrimaryAction(order.status)}
                  </Link>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">№</th>
                    <th className="px-4 py-3">Поставщик</th>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3 text-right">Сумма</th>
                    <th className="px-4 py-3 text-right">Следующий шаг</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <Link
                          href={'/purchase-orders/' + order.id}
                          className="font-bold text-gray-900 hover:text-blue-700"
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
                      <td className="px-4 py-4 text-right font-bold tabular-nums text-blue-600">
                        {formatCurrency(order.total_amount)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={'/purchase-orders/' + order.id}
                          className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
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
