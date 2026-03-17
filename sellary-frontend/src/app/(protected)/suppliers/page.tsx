'use client';

import { useState } from 'react';
import { suppliersApi } from '@/lib/api';
import { Supplier } from '@/lib/types';

import { TableSkeleton } from '@/components/skeletons';
import {
    PencilIcon,
    TrashIcon,
    PlusIcon,
    MagnifyingGlassIcon,
    PhoneIcon,
    EnvelopeIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useSuppliers } from '@/hooks/useQueries';
import { useQueryClient, useMutation } from '@tanstack/react-query';

export default function Suppliers() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
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

    const params: any = { limit: 100 };
    if (searchQuery) params.search = searchQuery;

    const { data: suppliers = [], isLoading: loading } = useSuppliers(params);

    const createSupplierMutation = useMutation({
        mutationFn: (data: any) => suppliersApi.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            toast.success('Поставщик создан');
            setShowModal(false);
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Не удалось создать поставщика');
        }
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
        }
    });

    const deleteSupplierMutation = useMutation({
        mutationFn: (id: number) => suppliersApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            toast.success('Поставщик удален');
        },
        onError: (error: any) => {
            toast.error('Не удалось удалить поставщика');
        }
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

    const handleDelete = async (id: number) => {
        if (!confirm('Вы уверены, что хотите удалить этого поставщика?')) return;
        deleteSupplierMutation.mutate(id);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (editingSupplier) {
            updateSupplierMutation.mutate({ id: editingSupplier.id, data: formData });
        } else {
            createSupplierMutation.mutate(formData);
        }
    };

    return (
        <>

            <div className="space-y-4 sm:space-y-6 pb-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Поставщики</h1>
                        <p className="text-xs sm:text-base text-gray-600 dark:text-gray-400">Управление базой поставщиков</p>
                    </div>
                    <button
                        onClick={handleCreate}
                        className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm sm:text-base self-start sm:self-auto"
                    >
                        <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">Добавить поставщика</span>
                        <span className="sm:hidden">Добавить</span>
                    </button>
                </div>

                {/* Search */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Поиск поставщиков..."
                            className="w-full h-9 sm:h-10 pl-9 sm:pl-10 pr-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm sm:text-base"
                        />
                    </div>
                </div>

                {/* Suppliers List */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    {loading ? (
                        <div className="p-4"><TableSkeleton rows={5} columns={5} /></div>
                    ) : suppliers.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">Поставщики не найдены</div>
                    ) : (
                        <>
                            {/* Mobile View - Cards */}
                            <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                                {suppliers.map((supplier: Supplier) => (
                                    <div key={supplier.id} className="p-3">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{supplier.name}</p>
                                                {supplier.contact_person && (
                                                    <p className="text-[10px] text-gray-500">{supplier.contact_person}</p>
                                                )}
                                            </div>
                                            <div className="flex gap-1 ml-2">
                                                <button
                                                    onClick={() => handleEdit(supplier)}
                                                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                                                >
                                                    <PencilIcon className="w-5 h-5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(supplier.id)}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                >
                                                    <TrashIcon className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-xs">
                                            <a href={`tel:${supplier.phone}`} className="flex items-center gap-1 text-blue-600">
                                                <PhoneIcon className="w-3 h-3" />
                                                {supplier.phone}
                                            </a>
                                            {supplier.email && (
                                                <a href={`mailto:${supplier.email}`} className="flex items-center gap-1 text-gray-500">
                                                    <EnvelopeIcon className="w-3 h-3" />
                                                    <span className="truncate max-w-[120px]">{supplier.email}</span>
                                                </a>
                                            )}
                                        </div>
                                        {supplier.payment_terms && (
                                            <p className="text-[10px] text-gray-500 mt-1">Оплата: {supplier.payment_terms}</p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Desktop View - Table */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50 dark:bg-gray-700">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Наименование</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Контакт</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Email</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Телефон</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Условия</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Действия</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {suppliers.map((supplier: Supplier) => (
                                            <tr key={supplier.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{supplier.name}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{supplier.contact_person || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{supplier.email || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{supplier.phone}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{supplier.payment_terms || '-'}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex gap-2">
                                                        <button onClick={() => handleEdit(supplier)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 rounded-lg">
                                                            <PencilIcon className="w-5 h-5" />
                                                        </button>
                                                        <button onClick={() => handleDelete(supplier.id)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded-lg">
                                                            <TrashIcon className="w-5 h-5" />
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

            {/* Create/Edit Modal */}
            {
                showModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 sm:p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden">
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700">
                                <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
                                    {editingSupplier ? 'Редактировать' : 'Добавить поставщика'}
                                </h3>
                            </div>

                            <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] space-y-3 sm:space-y-4">
                                <div>
                                    <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Название *</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Контактное лицо</label>
                                    <input
                                        type="text"
                                        value={formData.contact_person}
                                        onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                                        className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Телефон *</label>
                                        <input
                                            type="tel"
                                            required
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Условия оплаты</label>
                                    <input
                                        type="text"
                                        value={formData.payment_terms}
                                        onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                                        className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                        placeholder="Напр: 50% предоплата"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Адрес</label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        className="w-full h-16 sm:h-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm resize-none"
                                    />
                                </div>

                                <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm sm:text-base order-2 sm:order-1"
                                    >
                                        Отмена
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={createSupplierMutation.isPending || updateSupplierMutation.isPending}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm sm:text-base order-1 sm:order-2"
                                    >
                                        {editingSupplier ? 'Сохранить' : 'Создать'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

        </>
    );
}
