'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MagnifyingGlassIcon, PencilIcon } from '@heroicons/react/24/outline';

import { customersApi, generateIdempotencyKey } from '@/lib/api';
import { Customer } from '@/lib/types';
import FilterMenu from '@/components/filters/FilterMenu';
import { ModuleGuard } from '@/components/ModuleGuard';
import QueryError from '@/components/ui/QueryError';
import CustomerEditSheet from '@/components/customers/CustomerEditSheet';
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

/**
 * One idempotency key per attempt at a thing, not per request.
 *
 * A key minted inside the submit handler is a new key on every press, so a
 * request that timed out after the server had already committed came back as
 * an unrelated one — and the refund, or the debt payment, was applied twice.
 * The key is held for as long as the dialog is open and cleared only on
 * success.
 */
function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null);
  const take = () => {
    if (!keyRef.current) {
      keyRef.current = generateIdempotencyKey();
    }
    return keyRef.current;
  };
  const reset = () => {
    keyRef.current = null;
  };
  return { take, reset };
}

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
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 300);
  const paymentKey = useIdempotencyKey();
  const customerParams: Record<string, string | number> = { limit: 200 };
  if (debouncedSearch.trim()) customerParams.search = debouncedSearch.trim();

  const {
    data: customers = [],
    isLoading: customersLoading,
    isError: customersError,
    refetch: refetchCustomers,
  } = useCustomers(customerParams);
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
        paymentKey.take(),
      );
      toast.success('Оплата долга сохранена');
      // Only a success retires the key; a retry after a timeout must be the
      // same payment, not a second one.
      paymentKey.reset();
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
      <div className="flex h-full min-h-0 flex-col gap-4 p-4">
        <div className="flex-none">
          <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Клиенты</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">Долги и история · {customers.length}</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--erp-divider)] bg-white">
          <div className="border-b border-[var(--erp-divider)] p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--erp-muted)]" />
              <input
                type="search"
                aria-label="Поиск клиентов"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск по имени, телефону или email..."
                className="h-10 w-full border border-[var(--erp-divider)] bg-white pl-9 pr-3 text-sm outline-none focus:border-[var(--erp-text)]"
              />
              </div>
              <FilterMenu activeCount={activeFilterCount} onReset={resetAdvancedFilters}>
                <div className="space-y-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                      Баланс
                    </p>
                    <div className="grid gap-1 border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-1">
                      {debtTabs.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          aria-label={tab.label}
                          data-filter-close
                          onClick={() => setDebtFilter(tab.key)}
                          className={`flex items-center justify-between px-3 py-2 text-sm font-medium transition-colors ${
                            debtFilter === tab.key
                              ? 'bg-white text-[var(--erp-text)]'
                              : 'text-gray-500 hover:text-[var(--erp-text)]'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span aria-hidden="true" className="text-xs tabular-nums text-[var(--erp-muted)]">
                            {tab.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs tabular-nums text-[var(--erp-muted)]">
                    Показано: {visibleCustomers.length} из {customers.length}
                  </p>
                </div>
              </FilterMenu>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {customersLoading ? (
              <div className="py-10 text-center text-sm text-[var(--erp-muted)]">Загрузка клиентов…</div>
            ) : customersError ? (
              <QueryError what="клиентов" onRetry={() => void refetchCustomers()} />
            ) : visibleCustomers.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--erp-muted)]">
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
                      className={`flex w-full items-center gap-3 border p-3 text-left transition-colors ${
                        selected
                          ? 'border-[var(--erp-text)] bg-[var(--erp-surface)]'
                          : 'border-[var(--erp-divider)] bg-white hover:bg-[var(--erp-surface)]'
                      }`}
                    >
                      <div className="grid h-10 w-10 place-items-center bg-[var(--erp-accent)] text-sm font-black text-white">
                        {(customer.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-[var(--erp-text)]">{customer.name}</p>
                        {customer.phone && <p className="text-xs text-gray-500">{customer.phone}</p>}
                        {customer.description && <p className="truncate text-xs text-[var(--erp-muted)]">{customer.description}</p>}
                      </div>
                      <span className={`shrink-0 font-black tabular-nums ${balance > 0 ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-muted)]'}`}>
                        {formatCurrency(customer.balance || '0')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 border border-[var(--erp-divider)] bg-white lg:w-[420px]">
          {selectedCustomer ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-[var(--erp-divider)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs uppercase tracking-wide text-[var(--erp-muted)]">Выбранный клиент</p>
                  {/* Quick-added at the register, in a hurry — a wrong phone
                      number used to be permanent. */}
                  <button
                    type="button"
                    onClick={() => setEditingCustomer(selectedCustomer)}
                    aria-label="Изменить данные клиента"
                    className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center text-[var(--erp-muted)] hover:bg-[var(--erp-surface)] hover:text-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </div>
                <h3 className="mt-1 text-lg font-black text-[var(--erp-text)]">{selectedCustomer.name}</h3>
                {selectedCustomer.phone && (
                  <p className="text-sm text-[var(--erp-muted)]">{selectedCustomer.phone}</p>
                )}
                <div className="mt-3 border border-[var(--erp-divider)] bg-red-50 p-3">
                  <p className="text-xs text-[var(--erp-accent)]">Текущий долг</p>
                  <p className="text-2xl font-black tabular-nums text-[var(--erp-accent)]">{formatCurrency(ledger?.balance ?? selectedCustomer.balance ?? '0')}</p>
                </div>
                <button
                  type="button"
                  onClick={openPayment}
                  disabled={Number(ledger?.balance ?? selectedCustomer.balance ?? 0) <= 0}
                  className="mt-3 w-full bg-[var(--erp-success)] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Принять оплату долга
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="mb-3 text-sm font-bold text-[var(--erp-text)]">История долга</p>
                {ledgerLoading ? (
                  <p className="py-6 text-center text-sm text-[var(--erp-muted)]">Загрузка истории…</p>
                ) : !ledger || ledger.entries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--erp-muted)]">История пуста</p>
                ) : (
                  <div className="space-y-2">
                    {ledger.entries.map((entry) => (
                      <div key={entry.id} className="border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-3">
                        <div className="flex justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--erp-text)]">
                              {entry.description || entryLabels[entry.entry_type] || entry.entry_type}
                            </p>
                            <p className="text-xs text-[var(--erp-muted)]">
                              {entryLabels[entry.entry_type] || entry.entry_type}
                              {entry.sale_id ? ` · чек #${entry.sale_id}` : ''}
                            </p>
                          </div>
                          <span className={`font-black tabular-nums ${Number(entry.amount) >= 0 ? 'text-[var(--erp-accent)]' : 'text-[var(--erp-success)]'}`}>
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
            <div className="p-10 text-center text-sm text-[var(--erp-muted)]">Выберите клиента</div>
          )}
        </aside>
        </div>
      </div>

      {editingCustomer && (
        <CustomerEditSheet
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['customers'] })}
        />
      )}

      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full bg-white p-4 shadow-2xl sm:max-w-md">
            <h2 className="text-lg font-black text-[var(--erp-text)]">Оплата долга</h2>
            <p className="mt-1 text-sm text-gray-500">{selectedCustomer.name}</p>

            <label className="mt-4 block text-sm font-medium text-gray-700">
              Сумма оплаты
              <input
                type="text"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                className="mt-1 h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-right text-lg font-bold tabular-nums outline-none focus:border-[var(--erp-text)]"
              />
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700">
              Способ оплаты долга
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as 'cash' | 'card' | 'mobile')}
                className="mt-1 h-11 w-full border border-[var(--erp-divider)] bg-white px-3 outline-none focus:border-[var(--erp-text)]"
              >
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="mobile">Мобильный</option>
              </select>
            </label>

            <label className="mt-3 block text-sm font-medium text-gray-700">
              Примечание
              <input
                type="text"
                value={paymentDescription}
                onChange={(event) => setPaymentDescription(event.target.value)}
                className="mt-1 h-11 w-full border border-[var(--erp-divider)] bg-white px-3 outline-none focus:border-[var(--erp-text)]"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-[var(--erp-surface)]"
                disabled={submittingPayment}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={savePayment}
                disabled={submittingPayment}
                className="bg-[var(--erp-success)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:bg-gray-400"
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
    <ModuleGuard module="customers">
      <Customers />
    </ModuleGuard>
  );
}
