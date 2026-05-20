'use client';

import { useState } from 'react';
import { purchaseOrdersApi, suppliersApi, productsApi } from '@/lib/api';
import { PurchaseOrder, Supplier, Product, PurchaseOrderStatus } from '@/lib/types';

import { TableSkeleton } from '@/components/skeletons';
import {
    PlusIcon,
    MagnifyingGlassIcon,
    EyeIcon,
    PencilIcon,
    TrashIcon,
    PaperAirplaneIcon,
    CheckCircleIcon,
    XCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import ReceiveItemsModal from '@/components/ReceiveItemsModal';
import { usePurchaseOrders } from '@/hooks/useQueries';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/utils';

export default function PurchaseOrders() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [supplierFilter, setSupplierFilter] = useState<string>('');
    const [showModal, setShowModal] = useState(false);
    const [showViewModal, setShowViewModal] = useState(false);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);
    const [viewingPO, setViewingPO] = useState<PurchaseOrder | null>(null);

    const [formData, setFormData] = useState({
        supplier_id: '',
        expected_delivery_date: '',
        notes: '',
    });

    const [items, setItems] = useState<Array<{ product_id: string; quantity_ordered: string; unit_cost: string }>>([
        { product_id: '', quantity_ordered: '1', unit_cost: '0' },
    ]);

    const params: any = { limit: 100 };
    if (searchQuery) params.search = searchQuery;
    if (statusFilter) params.status = statusFilter;
    if (supplierFilter) params.supplier_id = parseInt(supplierFilter);

    const { data: purchaseOrders = [], isLoading: loading } = usePurchaseOrders(params);

    const { data: suppliers = [] } = useQuery({
        queryKey: ['suppliers', 'all'],
        queryFn: async () => {
            const response = await suppliersApi.getAll({ limit: 100 });
            return response.data;
        }
    });

    const { data: products = [] } = useQuery({
        queryKey: ['products', 'active'],
        queryFn: async () => {
            const response = await productsApi.getAll({ limit: 100, active_only: true });
            return response.data;
        }
    });

    const sendMutation = useMutation({
        mutationFn: (id: number) => purchaseOrdersApi.send(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            toast.success('Заказ отправлен');
        },
        onError: (error: any) => toast.error(error.response?.data?.detail || 'Ошибка')
    });

    const cancelMutation = useMutation({
        mutationFn: (id: number) => purchaseOrdersApi.cancel(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            toast.success('Заказ отменен');
        },
        onError: (error: any) => toast.error(error.response?.data?.detail || 'Ошибка')
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => purchaseOrdersApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            toast.success('Заказ удален');
        },
        onError: (error: any) => toast.error(error.response?.data?.detail || 'Ошибка')
    });

    const createMutation = useMutation({
        mutationFn: (data: any) => purchaseOrdersApi.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            toast.success('Заказ создан');
            setShowModal(false);
        },
        onError: (error: any) => toast.error(error.response?.data?.detail || 'Ошибка')
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => purchaseOrdersApi.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            toast.success('Заказ обновлен');
            setShowModal(false);
        },
        onError: (error: any) => toast.error(error.response?.data?.detail || 'Ошибка')
    });

    const handleCreate = () => {
        setEditingPO(null);
        setFormData({ supplier_id: '', expected_delivery_date: '', notes: '' });
        setItems([{ product_id: '', quantity_ordered: '1', unit_cost: '0' }]);
        setShowModal(true);
    };

    const handleEdit = (po: PurchaseOrder) => {
        if (po.status !== 'draft') {
            toast.error('Можно редактировать только черновики');
            return;
        }
        setEditingPO(po);
        setFormData({
            supplier_id: po.supplier_id.toString(),
            expected_delivery_date: po.expected_delivery_date?.split('T')[0] || '',
            notes: po.notes || '',
        });
        setItems(po.items.map((item) => ({
            product_id: item.product_id.toString(),
            quantity_ordered: item.quantity_ordered.toString(),
            unit_cost: item.unit_cost,
        })));
        setShowModal(true);
    };

    const handleView = (po: PurchaseOrder) => {
        setViewingPO(po);
        setShowViewModal(true);
    };

    const handleSend = (po: PurchaseOrder) => {
        if (!confirm(`Отправить заказ #${po.id}?`)) return;
        sendMutation.mutate(po.id);
    };

    const handleCancel = (po: PurchaseOrder) => {
        if (!confirm(`Отменить заказ #${po.id}?`)) return;
        cancelMutation.mutate(po.id);
    };

    const handleDelete = (po: PurchaseOrder) => {
        if (!confirm(`Удалить заказ #${po.id}?`)) return;
        deleteMutation.mutate(po.id);
    };

    const handleReceive = (po: PurchaseOrder) => {
        setViewingPO(po);
        setShowReceiveModal(true);
    };

    const addItem = () => {
        setItems([...items, { product_id: '', quantity_ordered: '1', unit_cost: '0' }]);
    };

    const removeItem = (index: number) => {
        if (items.length > 1) {
            setItems(items.filter((_, i) => i !== index));
        }
    };

    const updateItem = (index: number, field: string, value: string) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = {
            supplier_id: parseInt(formData.supplier_id),
            expected_delivery_date: formData.expected_delivery_date || null,
            notes: formData.notes || null,
            items: items.map((item) => ({
                product_id: parseInt(item.product_id),
                quantity_ordered: parseFloat(item.quantity_ordered),
                unit_cost: parseFloat(item.unit_cost),
            })),
        };
        if (editingPO) {
            updateMutation.mutate({ id: editingPO.id, data });
        } else {
            createMutation.mutate(data);
        }
    };

    const getStatusBadge = (status: PurchaseOrderStatus) => {
        const styles: Record<string, string> = {
            draft: 'bg-gray-100 text-gray-800',
            sent: 'bg-blue-100 text-blue-800',
            partially_received: 'bg-yellow-100 text-yellow-800',
            received: 'bg-green-100 text-green-800',
            cancelled: 'bg-red-100 text-red-800',
        };
        return styles[status] || styles.draft;
    };

    const getStatusText = (status: string) => {
        const texts: Record<string, string> = {
            draft: 'Черновик',
            sent: 'Отправлен',
            partially_received: 'Частично',
            received: 'Получен',
            cancelled: 'Отменён',
        };
        return texts[status] || status;
    };

    const canEdit = (status: PurchaseOrderStatus) => status === 'draft';
    const canSend = (status: PurchaseOrderStatus) => status === 'draft';
    const canReceive = (status: PurchaseOrderStatus) => status === 'sent' || status === 'partially_received';
    const canCancel = (status: PurchaseOrderStatus) => status !== 'received' && status !== 'cancelled';
    const canDelete = (status: PurchaseOrderStatus) => status === 'draft';

    const calculateTotal = () => {
        return items.reduce((sum, item) => sum + (parseFloat(item.quantity_ordered) || 0) * (parseFloat(item.unit_cost) || 0), 0);
    };

    return (
        <>

            <div className="h-full overflow-y-auto mobile-no-overscroll p-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <button
                        onClick={handleCreate}
                        className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm sm:text-base self-start sm:self-auto"
                    >
                        <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">Создать заказ</span>
                        <span className="sm:hidden">Создать</span>
                    </button>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                        <div className="flex-1 relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Поиск..."
                                className="w-full h-9 sm:h-10 pl-9 pr-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                            />
                        </div>
                        <div className="flex gap-2">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="h-9 sm:h-10 px-2 sm:px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs sm:text-sm flex-1 sm:flex-none sm:w-32"
                            >
                                <option value="">Все</option>
                                <option value="draft">Черновик</option>
                                <option value="sent">Отправлен</option>
                                <option value="received">Получен</option>
                                <option value="cancelled">Отменён</option>
                            </select>
                            <select
                                value={supplierFilter}
                                onChange={(e) => setSupplierFilter(e.target.value)}
                                className="h-9 sm:h-10 px-2 sm:px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs sm:text-sm flex-1 sm:flex-none sm:w-40"
                            >
                                <option value="">Поставщик</option>
                                {suppliers.map((s: Supplier) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Purchase Orders */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    {loading ? (
                        <div className="p-4"><TableSkeleton rows={5} columns={5} /></div>
                    ) : purchaseOrders.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">Заказы не найдены</div>
                    ) : (
                        <>
                            {/* Mobile View - Cards */}
                            <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                                {purchaseOrders.map((po: PurchaseOrder) => (
                                    <div key={po.id} className="p-3">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-gray-900 dark:text-white text-sm">Заказ #{po.id}</p>
                                                <p className="text-[10px] text-gray-500">{po.supplier?.name}</p>
                                            </div>
                                            <span className={`ml-2 px-2 py-0.5 text-[10px] font-medium rounded flex-shrink-0 ${getStatusBadge(po.status)}`}>
                                                {getStatusText(po.status)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-[10px] text-gray-500">{new Date(po.order_date).toLocaleDateString()}</p>
                                                <p className="font-bold text-gray-900 dark:text-white text-sm">{formatCurrency(po.total_amount)}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <button onClick={() => handleView(po)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded">
                                                    <EyeIcon className="w-4 h-4" />
                                                </button>
                                                {canEdit(po.status) && (
                                                    <button onClick={() => handleEdit(po)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                                                        <PencilIcon className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {canSend(po.status) && (
                                                    <button onClick={() => handleSend(po)} className="p-1.5 text-green-600 hover:bg-green-50 rounded">
                                                        <PaperAirplaneIcon className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {canReceive(po.status) && (
                                                    <button onClick={() => handleReceive(po)} className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded">
                                                        <CheckCircleIcon className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop View - Table */}
                            <div className="hidden sm:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50 dark:bg-gray-700">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">№</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Поставщик</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Дата</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Статус</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Сумма</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Действия</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {purchaseOrders.map((po: PurchaseOrder) => (
                                            <tr key={po.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">#{po.id}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{po.supplier?.name || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{new Date(po.order_date).toLocaleDateString()}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(po.status)}`}>
                                                        {getStatusText(po.status)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(po.total_amount)}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex gap-1">
                                                        <button onClick={() => handleView(po)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"><EyeIcon className="w-4 h-4" /></button>
                                                        {canEdit(po.status) && <button onClick={() => handleEdit(po)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><PencilIcon className="w-4 h-4" /></button>}
                                                        {canSend(po.status) && <button onClick={() => handleSend(po)} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><PaperAirplaneIcon className="w-4 h-4" /></button>}
                                                        {canReceive(po.status) && <button onClick={() => handleReceive(po)} className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded"><CheckCircleIcon className="w-4 h-4" /></button>}
                                                        {canCancel(po.status) && <button onClick={() => handleCancel(po)} className="p-1.5 text-orange-600 hover:bg-orange-50 rounded"><XCircleIcon className="w-4 h-4" /></button>}
                                                        {canDelete(po.status) && <button onClick={() => handleDelete(po)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><TrashIcon className="w-4 h-4" /></button>}
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
                        <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-4xl max-h-[90vh] overflow-hidden">
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700">
                                <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
                                    {editingPO ? 'Редактировать' : 'Новый заказ'}
                                </h3>
                            </div>

                            <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Поставщик *</label>
                                        <select
                                            required
                                            value={formData.supplier_id}
                                            onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                                            className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                            disabled={!!editingPO}
                                        >
                                            <option value="">Выберите</option>
                                            {suppliers.map((s: Supplier) => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Дата доставки</label>
                                        <input
                                            type="date"
                                            value={formData.expected_delivery_date}
                                            onChange={(e) => setFormData({ ...formData, expected_delivery_date: e.target.value })}
                                            className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="text-sm sm:text-base font-medium text-gray-900 dark:text-white">Товары</h4>
                                        <button type="button" onClick={addItem} className="text-xs sm:text-sm text-blue-600">+ Добавить</button>
                                    </div>
                                    <div className="space-y-2">
                                        {items.map((item, index) => (
                                            <div key={index} className="flex gap-2 items-center">
                                                <select
                                                    required
                                                    value={item.product_id}
                                                    onChange={(e) => updateItem(index, 'product_id', e.target.value)}
                                                    className="flex-1 h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs sm:text-sm"
                                                >
                                                    <option value="">Товар</option>
                                                    {products.map((p: Product) => (
                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="number"
                                                    required
                                                    min="0"
                                                    step="0.001"
                                                    value={item.quantity_ordered}
                                                    onChange={(e) => updateItem(index, 'quantity_ordered', e.target.value)}
                                                    className="w-16 h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs sm:text-sm text-center"
                                                    placeholder="Кол"
                                                />
                                                <input
                                                    type="number"
                                                    required
                                                    min="0"
                                                    step="0.01"
                                                    value={item.unit_cost}
                                                    onChange={(e) => updateItem(index, 'unit_cost', e.target.value)}
                                                    className="w-20 h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs sm:text-sm text-center"
                                                    placeholder="Цена"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeItem(index)}
                                                    className="p-1.5 text-red-600"
                                                    disabled={items.length === 1}
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end mt-3">
                                        <p className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white">
                                            Итого: {formatCurrency(calculateTotal())}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm order-2 sm:order-1">
                                        Отмена
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={createMutation.isPending || updateMutation.isPending}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm order-1 sm:order-2"
                                    >
                                        {editingPO ? 'Сохранить' : 'Создать'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* View Details Modal */}
            {
                showViewModal && viewingPO && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 sm:p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-4xl max-h-[90vh] overflow-hidden">
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                                <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">Заказ #{viewingPO.id}</h3>
                                <button onClick={() => setShowViewModal(false)} className="p-1 text-gray-500 hover:text-gray-700">
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh]">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4">
                                    <div className="bg-gray-50 dark:bg-gray-700 p-2 sm:p-3 rounded-lg">
                                        <p className="text-[10px] sm:text-xs text-gray-500">Статус</p>
                                        <span className={`px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded ${getStatusBadge(viewingPO.status)}`}>
                                            {getStatusText(viewingPO.status)}
                                        </span>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-gray-700 p-2 sm:p-3 rounded-lg">
                                        <p className="text-[10px] sm:text-xs text-gray-500">Поставщик</p>
                                        <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">{viewingPO.supplier?.name}</p>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-gray-700 p-2 sm:p-3 rounded-lg">
                                        <p className="text-[10px] sm:text-xs text-gray-500">Дата</p>
                                        <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">{new Date(viewingPO.order_date).toLocaleDateString()}</p>
                                    </div>
                                    <div className="bg-gray-50 dark:bg-gray-700 p-2 sm:p-3 rounded-lg">
                                        <p className="text-[10px] sm:text-xs text-gray-500">Сумма</p>
                                        <p className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(viewingPO.total_amount)}</p>
                                    </div>
                                </div>

                                <h4 className="font-medium mb-2 text-sm sm:text-base text-gray-900 dark:text-white">Товары</h4>
                                <div className="space-y-2">
                                    {viewingPO.items.map((item) => (
                                        <div key={item.id} className="flex justify-between items-center p-2 sm:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">{item.product?.name}{item.product?.uom ? ` (${item.product.uom})` : ''}</p>
                                                <p className="text-[10px] sm:text-xs text-gray-500">
                                                    {item.quantity_received}/{item.quantity_ordered} получено
                                                </p>
                                            </div>
                                            <div className="text-right flex-shrink-0 ml-2">
                                                <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(item.subtotal)}</p>
                                                <p className="text-[10px] sm:text-xs text-gray-500">{formatCurrency(item.unit_cost)}/{item.product?.uom || 'шт'}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 flex justify-end">
                                    <button onClick={() => setShowViewModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">
                                        Закрыть
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Receive Items Modal */}
            {
                showReceiveModal && viewingPO && (
                    <ReceiveItemsModal
                        purchaseOrder={viewingPO}
                        onClose={() => setShowReceiveModal(false)}
                        onSuccess={() => {
                            setShowReceiveModal(false);
                            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
                        }}
                    />
                )
            }

        </>
    );
}
