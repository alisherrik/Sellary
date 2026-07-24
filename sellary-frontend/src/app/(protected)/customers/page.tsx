'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

import { customersApi, generateIdempotencyKey } from '@/lib/api';
import { Customer } from '@/lib/types';
import FilterMenu from '@/components/filters/FilterMenu';
import { ModuleGuard } from '@/components/ModuleGuard';
import { formatCurrency } from '@/lib/utils';
import { queryKeys, useCustomerLedger, useCustomers } from '@/hooks/useQueries';
import { useAuthStore } from '@/lib/store';
import { useDebounce } from '@/hooks/useDebounce';

const entryLabels: Record<string, string> = {
  credit_sale: 'Продажа в долг',
  payment: 'Оплата долга',
  return_adjustment: 'Возврат',
  cancel_adjustment: 'Аннулирование',
};

type CustomerDebtFilter = 'all' | 'debt' | 'clear';

function Customers() {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debtFilter, setDebtFilter] = useState<CustomerDebtFilter>('all');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);
  const customerParams: Record<string, string | number> = { limit: 200 };
  if (debouncedSearch.trim()) customerParams.search = debouncedSearch.trim();

  const { data: customers = [], isLoading: customersLoading } = useCustomers(customerParams);
  const visibleCustomers = useMemo(() => {
    if (debtFilter === 'debt') {
      return customers.filter((customer) => Number(customer.balance || 0) > 0);
    }
    if (debtFilter === 'clear') {
      return customers.filter((customer) => Number(customer.balance || 0) <= 0);
    }
    return customers;
  }, [customers, debtFilter]);
  const selectedCustomer = useMemo(
    () => visibleCustomers.find((customer) => customer.id === selectedCustomerId) ?? visibleCustomers[0] ?? null,
    [visibleCustomers, selectedCustomerId],
  );
  const { data: ledger, isLoading: ledgerLoading } = useCustomerLedger(selectedCustomer?.id ?? null);

  useEffect(() => {
    if (visibleCustomers.length === 0) {
      setSelectedCustomerId(null);
      return;
    }

    if (!visibleCustomers.some((customer) => customer.id === selectedCustomerId)) {
      setSelectedCustomerId(visibleCustomers[0].id);
    }
  }, [visibleCustomers, selectedCustomerId]);

  const customersWithDebt = useMemo(
    () => customers.filter((customer) => Number(customer.balance || 0) > 0).length,
    [customers],
  );
  const customersWithoutDebt = customers.length - customersWithDebt;
  const debtTabs: Array<{ key: CustomerDebtFilter; label: string; count: number }> = [
    { key: 'all', label: 'Все', count: customers.length },
    { key: 'debt', label: 'С долгом', count: customersWithDebt },
    { key: 'clear', label: 'Без долга', count: customersWithoutDebt },
  ];
  const hasFilters = Boolean(searchQuery.trim() || debtFilter !== 'all');
  const activeFilterCount = debtFilter !== 'all' ? 1 : 0;
  const resetAdvancedFilters = () => {
    setDebtFilter('all');
  };

  const openPayment = () => {
    if (!selectedCustomer) return;
    setPaymentAmount('');
    setPaymentDescription('');
    setPaymentMethod('cash');
    setShowPaymentModal(true);
  };

  const savePayment = async () => {
    if (!selectedCustomer) return;
    if (!paymentAmount.trim() || Number(paymentAmount) <= 0) {
      toast.error('Введите сумму оплаты');
      return;
    }

    setSubmittingPayment(true);
    try {
      await customersApi.recordPayment(
        selectedCustomer.id,
        {
          amount: paymentAmount,
          payment_method: paymentMethod,
          description: paymentDescription.trim() || undefined,
        },
        generateIdempotencyKey(),
      );
      toast.success('Оплата долга сохранена');
      setShowPaymentModal(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerLedger(companyId, selectedCustomer.id) }),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Не удалось сохранить оплату');
    } finally {
      setSubmittingPayment(false);
    }
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-100 p-4 dark:border-gray-700">
            <h1 className="text-xl font-black text-gray-900 dark:text-white">Клиенты</h1>
            <p className="text-sm text-gray-500">Клиенты для продаж в долг и история оплат.</p>
          </div>
          <div className="border-b border-gray-100 p-3 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                aria-label="Поиск клиентов"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск по имени, телефону или email..."
                className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              />
              </div>
              <FilterMenu activeCount={activeFilterCount} onReset={resetAdvancedFilters}>
                <div className="space-y-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Баланс
                    </p>
                    <div className="grid gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
                      {debtTabs.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          aria-label={tab.label}
                          data-filter-close
                          onClick={() => setDebtFilter(tab.key)}
                          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            debtFilter === tab.key
                              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span aria-hidden="true" className="text-xs tabular-nums text-gray-400">
                            {tab.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs tabular-nums text-gray-400">
                    Показано: {visibleCustomers.length} из {customers.length}
                  </p>
                </div>
              </FilterMenu>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {customersLoading ? (
              <div className="py-10 text-center text-sm text-gray-400">Загрузка клиентов…</div>
            ) : visibleCustomers.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                {hasFilters ? 'Клиенты не найдены' : 'Клиентов пока нет'}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleCustomers.map((customer: Customer) => {
                  const selected = selectedCustomer?.id === customer.id;
                  const balance = Number(customer.balance || 0);
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => setSelectedCustomerId(customer.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                        selected
                          ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
                          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-gray-900 text-sm font-black text-white">
                        {(customer.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-gray-900 dark:text-white">{customer.name}</p>
                        {customer.phone && <p className="text-xs text-gray-500">{customer.phone}</p>}
                        {customer.description && <p className="truncate text-xs text-gray-400">{customer.description}</p>}
                      </div>
                      <span className={`shrink-0 font-black tabular-nums ${balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {formatCurrency(customer.balance || '0')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:w-[420px]">
          {selectedCustomer ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-gray-100 p-4 dark:border-gray-700">
                <p className="text-xs uppercase tracking-wide text-gray-400">Выбранный клиент</p>
                <h2 className="mt-1 text-lg font-black text-gray-900 dark:text-white">{selectedCustomer.name}</h2>
                {selectedCustomer.phone && <p className="text-sm text-gray-500">{selectedCustomer.phone}</p>}
                <div className="mt-3 rounded-2xl bg-red-50 p-3 dark:bg-red-900/20">
                  <p className="text-xs text-red-500">Текущий долг</p>
                  <p className="text-2xl font-black tabular-nums text-red-600">{formatCurrency(ledger?.balance ?? selectedCustomer.balance ?? '0')}</p>
                </div>
                <button
                  type="button"
                  onClick={openPayment}
                  disabled={Number(ledger?.balance ?? selectedCustomer.balance ?? 0) <= 0}
                  className="mt-3 w-full rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Принять оплату долга
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">История долга</p>
                {ledgerLoading ? (
                  <p className="py-6 text-center text-sm text-gray-400">Загрузка истории…</p>
                ) : !ledger || ledger.entries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">История пуста</p>
                ) : (
                  <div className="space-y-2">
                    {ledger.entries.map((entry) => (
                      <div key={entry.id} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/50">
                        <div className="flex justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                              {entry.description || entryLabels[entry.entry_type] || entry.entry_type}
                            </p>
                            <p className="text-xs text-gray-400">
                              {entryLabels[entry.entry_type] || entry.entry_type}
                              {entry.sale_id ? ` · чек #${entry.sale_id}` : ''}
                            </p>
                          </div>
                          <span className={`font-black tabular-nums ${Number(entry.amount) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {Number(entry.amount) >= 0 ? '+' : ''}
                            {formatCurrency(entry.amount)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-sm text-gray-400">Выберите клиента</div>
          )}
        </aside>
      </div>

      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl">
            <h2 className="text-lg font-black text-gray-900 dark:text-white">Оплата долга</h2>
            <p className="mt-1 text-sm text-gray-500">{selectedCustomer.name}</p>

            <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Сумма оплаты
              <input
                type="text"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-right text-lg font-bold tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Способ оплаты долга
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as 'cash' | 'card' | 'mobile')}
                className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              >
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="mobile">Мобильный</option>
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Примечание
              <input
                type="text"
                value={paymentDescription}
                onChange={(event) => setPaymentDescription(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                disabled={submittingPayment}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={savePayment}
                disabled={submittingPayment}
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-gray-400"
              >
                Сохранить оплату
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function CustomersPage() {
  return (
    <ModuleGuard module="pos">
      <Customers />
    </ModuleGuard>
  );
}
