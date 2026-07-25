'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { suppliersApi } from '@/lib/api';
import { Supplier } from '@/lib/types';
import FilterMenu from '@/components/filters/FilterMenu';
import { ModuleGuard } from '@/components/ModuleGuard';
import QueryError from '@/components/ui/QueryError';
import { TableSkeleton } from '@/components/skeletons';
import { useSuppliers } from '@/hooks/useQueries';
import { useDebounce } from '@/hooks/useDebounce';

type SupplierFilter = 'all' | 'with_terms' | 'without_terms' | 'with_email';

function Suppliers() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState<SupplierFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    payment_terms: '',
    address: '',
  });

  const debouncedSearch = useDebounce(searchQuery, 300);
  const params: Record<string, string | number> = { limit: 100 };
  if (debouncedSearch.trim()) params.search = debouncedSearch.trim();

  const { data: suppliers = [], isLoading: loading, isError, refetch } = useSuppliers(params);
  const visibleSuppliers = useMemo(() => {
    if (supplierFilter === 'with_terms') {
      return suppliers.filter((supplier) => Boolean(supplier.payment_terms?.trim()));
    }
    if (supplierFilter === 'without_terms') {
      return suppliers.filter((supplier) => !supplier.payment_terms?.trim());
    }
    if (supplierFilter === 'with_email') {
      return suppliers.filter((supplier) => Boolean(supplier.email?.trim()));
    }
    return suppliers;
  }, [suppliers, supplierFilter]);
  const filterTabs: Array<{ key: SupplierFilter; label: string; count: number }> = [
    { key: 'all', label: 'Все', count: suppliers.length },
    {
      key: 'with_terms',
      label: 'С условиями',
      count: suppliers.filter((supplier) => Boolean(supplier.payment_terms?.trim())).length,
    },
    {
      key: 'without_terms',
      label: 'Без условий',
      count: suppliers.filter((supplier) => !supplier.payment_terms?.trim()).length,
    },
    {
      key: 'with_email',
      label: 'Есть email',
      count: suppliers.filter((supplier) => Boolean(supplier.email?.trim())).length,
    },
  ];
  const hasFilters = Boolean(searchQuery.trim() || supplierFilter !== 'all');
  const activeFilterCount = supplierFilter !== 'all' ? 1 : 0;
  const resetAdvancedFilters = () => {
    setSupplierFilter('all');
  };

  const createSupplierMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Поставщик создан');
      setShowModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось создать поставщика');
    },
  });

  const updateSupplierMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Поставщик обновлен');
      setShowModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось обновить поставщика');
    },
  });

  const deleteSupplierMutation = useMutation({
    mutationFn: (id: number) => suppliersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Поставщик удален');
    },
    onError: () => {
      toast.error('Не удалось удалить поставщика');
    },
  });

  const handleCreate = () => {
    setEditingSupplier(null);
    setFormData({
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      payment_terms: '',
      address: '',
    });
    setShowModal(true);
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone,
      payment_terms: supplier.payment_terms || '',
      address: supplier.address || '',
    });
    setShowModal(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить этого поставщика?')) {
      return;
    }
    deleteSupplierMutation.mutate(id);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSupplier) {
      updateSupplierMutation.mutate({ id: editingSupplier.id, data: formData });
    } else {
      createSupplierMutation.mutate(formData);
    }
  };

  return (
    <>
      <div className="h-full overflow-y-auto mobile-no-overscroll p-4">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div>
            <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Поставщики</h2>
            <p className="mt-0.5 text-[13px] text-gray-500">{suppliers.length} активных</p>
          </div>
          <button
            onClick={handleCreate}
            className="ml-auto flex h-[38px] items-center justify-center gap-2 bg-[var(--erp-accent)] px-3 text-sm text-white hover:opacity-90 sm:px-4 sm:text-base"
          >
            <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="hidden sm:inline">Добавить поставщика</span>
            <span className="sm:hidden">Добавить</span>
          </button>
        </div>

        <div className="border border-[var(--erp-divider)] bg-white p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--erp-muted)] sm:h-5 sm:w-5" />
              <input
                type="search"
                aria-label="Поиск поставщиков"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск поставщиков..."
                className="h-9 w-full border border-[var(--erp-divider)] bg-white pl-9 pr-3 text-sm sm:h-10 sm:pl-10 sm:text-base"
              />
            </div>
            <FilterMenu activeCount={activeFilterCount} onReset={resetAdvancedFilters}>
              <div className="space-y-3">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                    Данные поставщика
                  </p>
                  <div className="grid gap-1 border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-1">
                    {filterTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        aria-label={tab.label}
                        data-filter-close
                        onClick={() => setSupplierFilter(tab.key)}
                        className={`flex items-center justify-between px-3 py-2 text-sm font-medium transition-colors ${
                          supplierFilter === tab.key
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
                  Показано: {visibleSuppliers.length} из {suppliers.length}
                </p>
              </div>
            </FilterMenu>
          </div>
        </div>

        <div className="mt-3 overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={5} columns={5} />
            </div>
          ) : isError ? (
            <QueryError what="поставщиков" onRetry={() => void refetch()} />
          ) : visibleSuppliers.length === 0 ? (
            <div className="p-8 text-center text-[var(--erp-muted)]">
              {hasFilters ? 'Поставщики не найдены' : 'Поставщиков пока нет'}
            </div>
          ) : (
            <>
              <div className="space-y-2 sm:hidden">
                {visibleSuppliers.map((supplier: Supplier) => (
                  <div key={supplier.id} className="border border-[var(--erp-divider)] bg-white p-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--erp-text)]">{supplier.name}</p>
                        {supplier.contact_person && (
                          <p className="text-xs text-gray-500">{supplier.contact_person}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                      {supplier.phone && (
                        <span className="flex items-center gap-1">
                          <PhoneIcon className="h-3 w-3" /> {supplier.phone}
                        </span>
                      )}
                      {supplier.email && (
                        <span className="flex items-center gap-1">
                          <EnvelopeIcon className="h-3 w-3" /> {supplier.email}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <button onClick={() => handleEdit(supplier)} className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-text)]" aria-label="Редактировать">
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(supplier.id)} className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-accent)]" aria-label="Удалить">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-[var(--erp-divider)]">
                      <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Наименование</th>
                      <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Контакт</th>
                      <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Email</th>
                      <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Телефон</th>
                      <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Условия</th>
                      <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--erp-divider)]">
                    {visibleSuppliers.map((supplier: Supplier) => (
                      <tr key={supplier.id} className="hover:bg-[var(--erp-surface)]">
                        <td className="px-4 py-3 text-sm font-medium text-[var(--erp-text)]">{supplier.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{supplier.contact_person || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{supplier.email || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{supplier.phone}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{supplier.payment_terms || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(supplier)}
                              className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-text)]"
                            >
                              <PencilIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleDelete(supplier.id)}
                              className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-accent)]"
                            >
                              <TrashIcon className="h-5 w-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full overflow-hidden bg-white sm:max-w-md">
            <div className="border-b border-[var(--erp-divider)] px-4 py-3 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-[var(--erp-text)] sm:text-xl">
                {editingSupplier ? 'Редактировать поставщика' : 'Добавить поставщика'}
              </h3>
            </div>

            <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto p-4 sm:space-y-4 sm:p-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">
                  Наименование *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-9 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm sm:h-10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">
                  Контактное лицо
                </label>
                <input
                  type="text"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                  className="h-9 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm sm:h-10"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-9 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">
                    Телефон *
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="h-9 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm sm:h-10"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">
                  Условия оплаты
                </label>
                <input
                  type="text"
                  value={formData.payment_terms}
                  onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                  className="h-9 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm sm:h-10"
                  placeholder="Напр.: 50% предоплата"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">
                  Адрес
                </label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="h-16 w-full resize-none border border-[var(--erp-divider)] bg-white px-3 py-2 text-sm sm:h-20"
                />
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-700 sm:flex-row sm:justify-end sm:gap-3 sm:pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="order-2 px-4 py-2 text-sm text-gray-600 hover:bg-[var(--erp-surface)] sm:order-1 sm:text-base"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createSupplierMutation.isPending || updateSupplierMutation.isPending}
                  className="order-1 bg-[var(--erp-accent)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 sm:order-2 sm:text-base"
                >
                  {editingSupplier ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default function SuppliersPage() {
  return (
    <ModuleGuard module="purchasing">
      <Suppliers />
    </ModuleGuard>
  );
}
