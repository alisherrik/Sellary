'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { productsApi, categoriesApi } from '@/lib/api';
import { Product, Category } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { TableSkeleton } from '@/components/skeletons';
import { useProducts } from '@/hooks/useQueries';

export default function Products() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [formData, setFormData] = useState({
    barcode: '',
    name: '',
    description: '',
    category_id: '',
    cost_price: '',
    sell_price: '',
    tax_percent: '0',
    stock_quantity: '0',
    min_stock_level: '5',
  });

  const params: any = { limit: 100 };
  if (searchQuery) params.search = searchQuery;
  if (selectedCategory) params.category_id = selectedCategory;

  const { data: products = [], isLoading: loading } = useProducts(params);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await categoriesApi.getAll({ active_only: true });
      return response.data;
    },
  });

  const createProductMutation = useMutation({
    mutationFn: (data: any) => productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар создан');
      setShowModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось создать товар');
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар обновлен');
      setShowModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось обновить товар');
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: number) => productsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар удален');
    },
    onError: () => {
      toast.error('Не удалось удалить товар');
    },
  });

  const handleCreate = () => {
    setEditingProduct(null);
    setFormData({
      barcode: '',
      name: '',
      description: '',
      category_id: '',
      cost_price: '',
      sell_price: '',
      tax_percent: '0',
      stock_quantity: '0',
      min_stock_level: '5',
    });
    setShowModal(true);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      barcode: product.barcode || '',
      name: product.name,
      description: product.description || '',
      category_id: product.category_id?.toString() || '',
      cost_price: product.cost_price,
      sell_price: product.sell_price,
      tax_percent: product.tax_percent,
      stock_quantity: product.stock_quantity.toString(),
      min_stock_level: product.min_stock_level.toString(),
    });
    setShowModal(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить этот товар?')) {
      return;
    }
    deleteProductMutation.mutate(id);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      ...formData,
      cost_price: parseFloat(formData.cost_price),
      sell_price: parseFloat(formData.sell_price),
      tax_percent: parseFloat(formData.tax_percent),
      stock_quantity: parseInt(formData.stock_quantity),
      min_stock_level: parseInt(formData.min_stock_level),
      category_id: formData.category_id ? parseInt(formData.category_id) : null,
    };

    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data });
    } else {
      createProductMutation.mutate(data);
    }
  };

  const getStockStatusColor = (product: Product) => {
    if (product.stock_quantity === 0) return 'bg-red-100 text-red-800';
    if (product.stock_quantity <= product.min_stock_level) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  return (
    <>
      <div className="space-y-4 pb-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">Товары</h1>
            <p className="text-xs text-gray-600 dark:text-gray-400 sm:text-base">
              Управление ассортиментом
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="self-start rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 sm:self-auto sm:px-4 sm:text-base"
          >
            <span className="flex items-center justify-center gap-2">
              <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="hidden sm:inline">Добавить товар</span>
              <span className="sm:hidden">Добавить</span>
            </span>
          </button>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 sm:h-5 sm:w-5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск..."
                className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10 sm:pl-10 sm:text-base"
              />
            </div>
            <select
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value ? parseInt(e.target.value) : null)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10 sm:text-base"
            >
              <option value="">Все категории</option>
              {categories.map((cat: Category) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={5} columns={6} />
            </div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Товары не найдены</div>
          ) : (
            <>
              <div className="divide-y divide-gray-100 dark:divide-gray-700 sm:hidden">
                {products.map((product: Product) => (
                  <div key={product.id} className="p-3">
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-[10px] text-gray-500">{product.barcode || 'Без штрихкода'}</p>
                      </div>
                      <span
                        className={`ml-2 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getStockStatusColor(product)}`}
                      >
                        {product.stock_quantity} шт
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">{product.category?.name || 'Без категории'}</p>
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          {formatCurrency(product.sell_price)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleEdit(product)}
                          className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleDelete(product.id)}
                          className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Штрихкод</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Наименование</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Категория</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Цена</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Остаток</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {products.map((product: Product) => (
                      <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{product.barcode || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{product.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{product.category?.name || '-'}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(product.sell_price)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStockStatusColor(product)}`}>
                            {product.stock_quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(product)}
                              className="rounded-lg p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900"
                            >
                              <PencilIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleDelete(product.id)}
                              className="rounded-lg p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900"
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
          <div className="max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white dark:bg-gray-800 sm:max-w-2xl sm:rounded-2xl">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6 sm:py-4">
              <h3 className="text-base font-bold text-gray-900 dark:text-white sm:text-xl">
                {editingProduct ? 'Редактировать товар' : 'Добавить товар'}
              </h3>
            </div>

            <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Штрихкод</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Наименование *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Категория</label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  >
                    <option value="">Выберите</option>
                    {categories.map((cat: Category) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Себестоимость *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Цена продажи *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={formData.sell_price}
                    onChange={(e) => setFormData({ ...formData, sell_price: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Налог (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={formData.tax_percent}
                    onChange={(e) => setFormData({ ...formData, tax_percent: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Количество *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formData.stock_quantity}
                    onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Мин. остаток</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.min_stock_level}
                    onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                    className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-10"
                  />
                </div>
              </div>

              <div className="mt-3 sm:mt-4">
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm">Описание</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="h-16 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 sm:h-20"
                />
              </div>

              <div className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-700 sm:mt-6 sm:flex-row sm:justify-end sm:gap-3 sm:pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="order-2 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 sm:order-1 sm:text-base"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createProductMutation.isPending || updateProductMutation.isPending}
                  className="order-1 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 sm:order-2 sm:text-base"
                >
                  {editingProduct ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
