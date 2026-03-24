'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MagnifyingGlassIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { TableSkeleton } from '@/components/skeletons';
import { useProducts } from '@/hooks/useQueries';
import { categoriesApi, productsApi } from '@/lib/api';
import { Category, Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

type CategoryModalMode = 'create' | 'edit';
type CategoryModalSource = 'manager' | 'product';

const emptyProductForm = {
  barcode: '',
  name: '',
  description: '',
  category_id: '',
  cost_price: '',
  sell_price: '',
  tax_percent: '0',
  stock_quantity: '0',
  min_stock_level: '5',
};

const emptyCategoryForm = {
  name: '',
  description: '',
};

export default function Products() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryModalMode, setCategoryModalMode] = useState<CategoryModalMode>('create');
  const [categoryModalSource, setCategoryModalSource] = useState<CategoryModalSource>('manager');
  const [formData, setFormData] = useState(emptyProductForm);
  const [categoryFormData, setCategoryFormData] = useState(emptyCategoryForm);

  const params: Record<string, string | number> = { limit: 100 };
  if (searchQuery) params.search = searchQuery;
  if (selectedCategory) params.category_id = selectedCategory;

  const { data: products = [], isLoading: loading } = useProducts(params);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await categoriesApi.getAll({ limit: 200 });
      return response.data;
    },
  });

  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  const refreshCategoryData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
    ]);
  };

  const closeCategoryModal = () => {
    setShowCategoryModal(false);
    setEditingCategory(null);
    setCategoryModalMode('create');
    setCategoryFormData(emptyCategoryForm);
  };

  const openCategoryCreateModal = (source: CategoryModalSource) => {
    setCategoryModalSource(source);
    setCategoryModalMode('create');
    setEditingCategory(null);
    setCategoryFormData(emptyCategoryForm);
    setShowCategoryModal(true);
  };

  const openCategoryEditModal = (category: Category) => {
    setCategoryModalSource('manager');
    setCategoryModalMode('edit');
    setEditingCategory(category);
    setCategoryFormData({
      name: category.name,
      description: category.description || '',
    });
    setShowCategoryModal(true);
  };

  const createCategoryMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => categoriesApi.create(data),
    onSuccess: async (response) => {
      const createdCategory = response.data as Category;
      await refreshCategoryData();

      if (categoryModalSource === 'product') {
        setFormData((current) => ({
          ...current,
          category_id: createdCategory.id.toString(),
        }));
      }

      closeCategoryModal();
      toast.success('Категория создана');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось создать категорию');
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; description?: string } }) =>
      categoriesApi.update(id, data),
    onSuccess: async () => {
      await refreshCategoryData();
      closeCategoryModal();
      toast.success('Категория обновлена');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось обновить категорию');
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: number) => categoriesApi.delete(categoryId),
    onSuccess: async (_response, categoryId) => {
      await refreshCategoryData();
      setSelectedCategory((current) => (current === categoryId ? null : current));
      setFormData((current) =>
        current.category_id === categoryId.toString() ? { ...current, category_id: '' } : current
      );
      if (editingCategory?.id === categoryId) {
        closeCategoryModal();
      }
      toast.success('Категория удалена');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось удалить категорию');
    },
  });

  const createProductMutation = useMutation({
    mutationFn: (data: any) => productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Товар создан');
      setShowProductModal(false);
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
      setShowProductModal(false);
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

  const handleCreateProduct = () => {
    setEditingProduct(null);
    setFormData(emptyProductForm);
    setShowProductModal(true);
  };

  const handleEditProduct = (product: Product) => {
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
    setShowProductModal(true);
  };

  const handleDeleteProduct = (productId: number) => {
    if (!confirm('Вы уверены, что хотите удалить этот товар?')) return;
    deleteProductMutation.mutate(productId);
  };

  const handleDeleteCategory = (category: Category) => {
    if (!confirm(`Удалить категорию "${category.name}"?`)) return;
    deleteCategoryMutation.mutate(category.id);
  };

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      ...formData,
      cost_price: parseFloat(formData.cost_price),
      sell_price: parseFloat(formData.sell_price),
      tax_percent: parseFloat(formData.tax_percent),
      stock_quantity: parseInt(formData.stock_quantity, 10),
      min_stock_level: parseInt(formData.min_stock_level, 10),
      category_id: formData.category_id ? parseInt(formData.category_id, 10) : null,
    };

    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data });
      return;
    }

    createProductMutation.mutate(data);
  };

  const handleCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      name: categoryFormData.name.trim(),
      description: categoryFormData.description.trim() || undefined,
    };

    if (categoryModalMode === 'edit' && editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, data: payload });
      return;
    }

    createCategoryMutation.mutate(payload);
  };

  const getStockStatusColor = (product: Product) => {
    if (product.stock_quantity === 0) return 'bg-red-100 text-red-800';
    if (product.stock_quantity <= product.min_stock_level) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const isSavingCategory = createCategoryMutation.isPending || updateCategoryMutation.isPending;

  return (
    <>
      <div className="space-y-4 sm:space-y-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Товары</h1>
            <p className="text-xs sm:text-base text-gray-600 dark:text-gray-400">
              Управление ассортиментом и категориями
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setShowCategoryManager(true)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-sm sm:text-base shadow-sm"
            >
              <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>Категории</span>
            </button>
            <button
              type="button"
              onClick={handleCreateProduct}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm sm:text-base shadow-sm"
            >
              <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Добавить товар</span>
              <span className="sm:hidden">Добавить</span>
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
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
              onChange={(e) => setSelectedCategory(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm sm:text-base"
            >
              <option value="">Все категории</option>
              {sortedCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={5} columns={6} />
            </div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Товары не найдены</div>
          ) : (
            <>
              <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {products.map((product) => (
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
                        <button type="button" onClick={() => handleEditProduct(product)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                          <PencilIcon className="w-5 h-5" />
                        </button>
                        <button type="button" onClick={() => handleDeleteProduct(product.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden sm:block overflow-x-auto">
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
                    {products.map((product) => (
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
                            <button type="button" onClick={() => handleEditProduct(product)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 rounded-lg">
                              <PencilIcon className="w-5 h-5" />
                            </button>
                            <button type="button" onClick={() => handleDeleteProduct(product.id)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded-lg">
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

      {showProductModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
                {editingProduct ? 'Редактировать товар' : 'Добавить товар'}
              </h3>
            </div>

            <form onSubmit={handleProductSubmit} className="p-4 sm:p-6 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Штрихкод</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
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
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Категория</label>
                  <div className="flex gap-2">
                    <select
                      value={formData.category_id}
                      onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                      className="flex-1 h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    >
                      <option value="">Выберите</option>
                      {sortedCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => openCategoryCreateModal('product')}
                      className="px-3 h-9 sm:h-10 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 text-sm whitespace-nowrap"
                    >
                      Новая
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCategoryManager(true)}
                    className="mt-2 text-xs sm:text-sm text-blue-600 hover:text-blue-700"
                  >
                    Управлять категориями
                  </button>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Себестоимость *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Цена продажи *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={formData.sell_price}
                    onChange={(e) => setFormData({ ...formData, sell_price: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Налог (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={formData.tax_percent}
                    onChange={(e) => setFormData({ ...formData, tax_percent: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Количество *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formData.stock_quantity}
                    onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Мин. остаток</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.min_stock_level}
                    onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 sm:mt-4">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Описание</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full h-16 sm:h-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm resize-none"
                />
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm sm:text-base order-2 sm:order-1"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createProductMutation.isPending || updateProductMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm sm:text-base order-1 sm:order-2"
                >
                  {editingProduct ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCategoryManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-[60] sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl max-h-[90vh] overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">Управление категориями</h3>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Здесь можно добавлять, редактировать и удалять категории.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCategoryCreateModal('manager')}
                className="shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                <PlusIcon className="w-4 h-4" />
                <span>Добавить</span>
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto max-h-[72vh] space-y-3">
              {sortedCategories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-gray-500">
                  Категорий пока нет
                </div>
              ) : (
                sortedCategories.map((category) => (
                  <div
                    key={category.id}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 dark:text-white">{category.name}</p>
                        {!category.is_active && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                            Неактивна
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">
                        {category.description || 'Без описания'}
                      </p>
                    </div>

                    <div className="flex gap-2 sm:flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => openCategoryEditModal(category)}
                        className="px-3 py-2 text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        Редактировать
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(category)}
                        disabled={deleteCategoryMutation.isPending}
                        className="px-3 py-2 text-sm text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCategoryManager(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm sm:text-base"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-[70] sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
                {categoryModalMode === 'edit' ? 'Редактировать категорию' : 'Добавить категорию'}
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                {categoryModalSource === 'product'
                  ? 'Новая категория сразу появится в форме товара и будет выбрана автоматически.'
                  : 'Изменения сразу появятся в списке категорий и товарах.'}
              </p>
            </div>

            <form onSubmit={handleCategorySubmit} className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Название *</label>
                <input
                  type="text"
                  required
                  value={categoryFormData.name}
                  onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                  className="w-full h-9 sm:h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  placeholder="Например: Напитки"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Описание</label>
                <textarea
                  value={categoryFormData.description}
                  onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
                  className="w-full h-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm resize-none"
                  placeholder="Короткое описание категории"
                />
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCategoryModal}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm sm:text-base"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingCategory}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm sm:text-base"
                >
                  {isSavingCategory
                    ? categoryModalMode === 'edit'
                      ? 'Сохранение...'
                      : 'Создание...'
                    : categoryModalMode === 'edit'
                      ? 'Сохранить'
                      : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
