'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { TableSkeleton } from '@/components/skeletons';
import { ModuleGuard } from '@/components/ModuleGuard';
import CategoryPicker from '@/components/categories/CategoryPicker';
import QueryError from '@/components/ui/QueryError';
import { useDebounce } from '@/hooks/useDebounce';
import { useLowStockProducts, useProducts } from '@/hooks/useQueries';
import { categoriesApi, inventoryApi, productsApi } from '@/lib/api';
import { Category, Product } from '@/lib/types';
import { formatCurrency, formatUnitPrice, toPriceInput } from '@/lib/utils';

type CategoryModalMode = 'create' | 'edit';
type CategoryModalSource = 'manager' | 'product';
type StatusFilter = 'all' | 'low' | 'out';

const emptyProductForm = {
  barcode: '',
  name: '',
  description: '',
  category_id: '',
  uom: 'dona',
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

// A row in the additional-units editor. Strings while editing; parsed on submit.
type UnitRow = { name: string; factor: string; sell_price: string; barcode: string };
const emptyUnitRow: UnitRow = { name: '', factor: '', sell_price: '', barcode: '' };

// Deterministic colour per category so the same category always reads the same
// across the sidebar dots and the in-table badges. Classes are spelled out in
// full so Tailwind keeps them in the build.
const categoryPalette = [
  { dot: 'bg-sky-500', badge: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  { dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  { dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  { dot: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  { dot: 'bg-teal-500', badge: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
] as const;

const catColor = (id?: number | null) =>
  id == null
    ? { dot: 'bg-gray-300', badge: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
    : categoryPalette[id % categoryPalette.length];

function PublishSwitch({
  published,
  disabled,
  onToggle,
}: {
  published: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={published}
      aria-label="Опубликовать в маркетплейсе"
      disabled={disabled}
      onClick={onToggle}
      title={published ? 'Опубликован в маркетплейсе' : 'Не опубликован'}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        published ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          published ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const stockBar = (product: Product) => {
  const ref = Math.max(product.min_stock_level * 5, 1);
  const pct = Math.min(100, Math.max(product.stock_quantity > 0 ? 6 : 0, (product.stock_quantity / ref) * 100));
  if (product.stock_quantity === 0) return { pct: 0, color: 'bg-red-500' };
  if (product.stock_quantity <= product.min_stock_level) return { pct, color: 'bg-red-500' };
  if (product.stock_quantity <= product.min_stock_level * 2) return { pct, color: 'bg-amber-500' };
  return { pct, color: 'bg-emerald-500' };
};

function Products() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryModalMode, setCategoryModalMode] = useState<CategoryModalMode>('create');
  const [categoryModalSource, setCategoryModalSource] = useState<CategoryModalSource>('manager');
  const [formData, setFormData] = useState(emptyProductForm);
  const [formUnits, setFormUnits] = useState<UnitRow[]>([]);
  const [categoryFormData, setCategoryFormData] = useState(emptyCategoryForm);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Debounce so typing in search doesn't fire a network request per keystroke.
  const debouncedSearch = useDebounce(searchQuery, 300);
  const params: Record<string, string | number> = { limit: 100 };
  if (debouncedSearch) params.search = debouncedSearch;
  if (selectedCategory) params.category_id = selectedCategory;

  const { data: products = [], isLoading: loading, isError, refetch } = useProducts(params);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', 'active'],
    queryFn: async () => {
      // Only active categories — inactive ones are hidden everywhere; their
      // products were detached to "uncategorized" on deactivation.
      const response = await categoriesApi.getAll({ limit: 200, active_only: true });
      return response.data;
    },
  });

  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  // Reorder counts come from the server, over the whole catalogue. Deriving
  // them from the 100 products this page happens to have loaded made "what do
  // I reorder" quietly wrong for any shop past 100 SKUs.
  const { data: lowStock = [] } = useLowStockProducts();

  const lowCount = useMemo(
    () => lowStock.filter((p) => p.stock_quantity > 0).length,
    [lowStock],
  );
  const outCount = useMemo(() => lowStock.filter((p) => p.stock_quantity === 0).length, [lowStock]);

  const visibleProducts = useMemo(() => {
    // The status tabs read the server's list; search and category still narrow
    // it, so a filtered view stays a filtered view.
    const matchesFilters = (product: Product) =>
      (!selectedCategory || product.category_id === selectedCategory) &&
      (!debouncedSearch ||
        product.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (product.barcode ?? '').toLowerCase().includes(debouncedSearch.toLowerCase()));

    if (statusFilter === 'low') {
      return lowStock.filter((p) => p.stock_quantity > 0).filter(matchesFilters);
    }
    if (statusFilter === 'out') {
      return lowStock.filter((p) => p.stock_quantity === 0).filter(matchesFilters);
    }
    return products;
  }, [debouncedSearch, lowStock, products, selectedCategory, statusFilter]);

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
    mutationFn: async ({
      id,
      data,
      quantityChange,
    }: {
      id: number;
      data: any;
      quantityChange: number;
    }) => {
      await productsApi.update(id, data);

      if (quantityChange !== 0) {
        await inventoryApi.adjust({
          product_id: id,
          quantity_change: quantityChange,
          reason: 'Корректировка остатка при редактировании товара',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
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

  const publishProductMutation = useMutation({
    mutationFn: ({ id, is_published }: { id: number; is_published: boolean }) =>
      productsApi.update(id, { is_published }),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(
        variables.is_published
          ? 'Товар опубликован в маркетплейсе'
          : 'Товар снят с публикации',
      );
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось изменить публикацию');
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      productsApi.uploadImage(id, file),
    onSuccess: (response) => {
      setImagePreview((response.data as Product).image_url ?? null);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Фото загружено');
    },
    onError: (error: any) => {
      // FastAPI 422 returns `detail` as an array of {type,loc,msg,input} objects.
      // Rendering that object directly crashes React (#31), so coerce to a string.
      const detail = error.response?.data?.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
            : '';
      toast.error(message || 'Не удалось загрузить фото');
    },
  });

  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !editingProduct) return;
    uploadImageMutation.mutate({ id: editingProduct.id, file });
  };

  const handleCreateProduct = () => {
    setEditingProduct(null);
    setFormData(emptyProductForm);
    setFormUnits([]);
    setImagePreview(null);
    setShowProductModal(true);
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      barcode: product.barcode || '',
      name: product.name,
      description: product.description || '',
      category_id: product.category_id?.toString() || '',
      uom: product.uom || 'dona',
      // Prices are numeric(10,4), so the API sends "20.0000". Trim the padding
      // or the operator edits a box full of zeros they never typed.
      cost_price: toPriceInput(product.cost_price),
      sell_price: toPriceInput(product.sell_price),
      tax_percent: product.tax_percent,
      stock_quantity: product.stock_quantity.toString(),
      min_stock_level: product.min_stock_level.toString(),
    });
    setFormUnits(
      (product.units ?? []).map((unit) => ({
        name: unit.name,
        factor: String(unit.factor),
        sell_price: toPriceInput(unit.sell_price),
        barcode: unit.barcode ?? '',
      })),
    );
    setImagePreview(product.image_url ?? null);
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

  const updateUnitRow = (index: number, field: keyof UnitRow, value: string) =>
    setFormUnits((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Keep only complete unit rows; sort_order follows the editor order.
    const units = formUnits
      .map((row, index) => ({
        name: row.name.trim(),
        factor: parseFloat(row.factor),
        sell_price: parseFloat(row.sell_price),
        barcode: row.barcode.trim() || null,
        is_active: true,
        sort_order: index,
      }))
      .filter((row) => row.name && row.factor > 0 && row.sell_price >= 0);

    const { min_stock_level: minStockLevel, ...productFormData } = formData;
    const data = {
      ...productFormData,
      cost_price: parseFloat(formData.cost_price),
      sell_price: parseFloat(formData.sell_price),
      tax_percent: parseFloat(formData.tax_percent),
      stock_quantity: parseFloat(formData.stock_quantity),
      ...(minStockLevel.trim()
        ? { min_stock_level: parseFloat(minStockLevel) }
        : {}),
      category_id: formData.category_id ? parseInt(formData.category_id, 10) : null,
      units,
    };

    if (editingProduct) {
      const { stock_quantity: desiredStockQuantity, ...productData } = data;
      const quantityChange = Number(
        (desiredStockQuantity - editingProduct.stock_quantity).toFixed(3),
      );

      updateProductMutation.mutate({
        id: editingProduct.id,
        data: productData,
        quantityChange,
      });
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

  const isSavingCategory = createCategoryMutation.isPending || updateCategoryMutation.isPending;

  const statusTabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'all', label: 'Все' },
    { key: 'low', label: 'Мало', count: lowCount },
    { key: 'out', label: 'Нет в наличии', count: outCount },
  ];

  return (
    <>
      <div className="flex h-full min-h-0 flex-col p-4">
        {/* Page header */}
        <div className="mb-4 flex flex-none flex-wrap items-end gap-4">
          <div>
            <h2 className="text-[30px] font-extrabold tracking-tight text-[var(--erp-text)]">Товары</h2>
            <p className="mt-0.5 text-[13px] text-gray-500">
              {visibleProducts.length} позиций
              {lowCount + outCount > 0 ? ` · ${lowCount + outCount} заканчивается` : ''}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setShowCategoryManager(true)}
              className="flex h-[38px] shrink-0 items-center justify-center gap-2 border border-[var(--erp-divider)] bg-white px-3 text-sm font-semibold text-[var(--erp-text)] transition-colors hover:border-[var(--erp-text)] lg:hidden"
            >
              <Cog6ToothIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Категории</span>
            </button>
            <button
              type="button"
              onClick={handleCreateProduct}
              className="flex h-[38px] shrink-0 items-center justify-center gap-2 bg-[var(--erp-accent)] px-3 text-sm font-semibold text-white transition-colors hover:opacity-90 sm:px-4"
            >
              <PlusIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Добавить товар</span>
            </button>
          </div>
        </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Category rail — desktop */}
        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border border-[var(--erp-divider)] bg-white p-3 lg:flex">
          <div className="mb-2 flex items-center px-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--erp-muted)]">Категории</span>
            <button
              type="button"
              onClick={() => setShowCategoryManager(true)}
              title="Управление категориями"
              className="ml-auto p-1 text-[var(--erp-muted)] transition-colors hover:text-[var(--erp-accent)]"
            >
              <Cog6ToothIcon className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-sm transition-colors ${
              selectedCategory === null
                ? 'bg-[var(--erp-surface)] font-semibold text-[var(--erp-text)]'
                : 'text-gray-600 hover:bg-[var(--erp-surface)]'
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 bg-blue-500" />
            Все товары
          </button>

          <div className="mt-0.5 space-y-0.5">
            {sortedCategories.map((category) => {
              const active = selectedCategory === category.id;
              const color = catColor(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(active ? null : category.id)}
                  className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-[var(--erp-surface)] font-semibold text-[var(--erp-text)]'
                      : 'text-gray-600 hover:bg-[var(--erp-surface)]'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 ${color.dot}`} />
                  <span className="truncate">{category.name}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => openCategoryCreateModal('manager')}
            className="mt-2 flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-[var(--erp-accent)] transition-colors hover:bg-[var(--erp-surface)]"
          >
            <PlusIcon className="h-4 w-4" />
            Добавить категорию
          </button>
        </aside>

        {/* Main panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Toolbar */}
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--erp-muted)] sm:h-5 sm:w-5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по названию или штрихкоду…"
                  className="h-10 w-full border border-[var(--erp-divider)] bg-white pl-9 pr-3 text-sm outline-none focus:border-[var(--erp-text)] sm:pl-10"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex gap-0.5 border border-[var(--erp-divider)] bg-white p-1">
                {statusTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      statusFilter === tab.key
                        ? 'bg-[var(--erp-text)] text-white'
                        : 'text-gray-500 hover:text-[var(--erp-text)]'
                    }`}
                  >
                    {tab.label}
                    {tab.count != null && tab.count > 0 && (
                      <span className="ml-1.5 opacity-70">· {tab.count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Category chips — mobile */}
            <div className="-mx-1 flex gap-2 overflow-x-auto whitespace-nowrap px-1 lg:hidden">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className={`shrink-0 px-3 py-1.5 text-xs font-medium ${
                  selectedCategory === null
                    ? 'bg-[var(--erp-accent)] text-white'
                    : 'border border-[var(--erp-divider)] bg-white text-gray-600'
                }`}
              >
                Все
              </button>
              {sortedCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    setSelectedCategory(selectedCategory === category.id ? null : category.id)
                  }
                  className={`shrink-0 px-3 py-1.5 text-xs font-medium ${
                    selectedCategory === category.id
                      ? 'bg-[var(--erp-accent)] text-white'
                      : 'border border-[var(--erp-divider)] bg-white text-gray-600'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-hidden border-2 border-[var(--erp-divider)] bg-white">
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={6} columns={5} />
              </div>
            ) : isError ? (
              <div className="p-4">
                <QueryError what="товары" onRetry={() => void refetch()} />
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="p-12 text-center text-[var(--erp-muted)]">Товары не найдены</div>
            ) : (
              <div className="h-full overflow-y-auto">
                {/* Mobile cards */}
                <div className="space-y-2 p-2 sm:hidden">
                  {visibleProducts.map((product) => {
                    const color = catColor(product.category_id);
                    const bar = stockBar(product);
                    return (
                      <div
                        key={product.id}
                        className="border border-[var(--erp-divider)] bg-white p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[var(--erp-text)]">{product.name}</p>
                            {product.barcode && (
                              <p className="font-mono text-[11px] text-[var(--erp-muted)]">{product.barcode}</p>
                            )}
                          </div>
                          {product.category?.name && (
                            <span className={`shrink-0 px-2 py-0.5 text-[10px] font-medium ${color.badge}`}>
                              {product.category.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="flex items-baseline gap-3 text-xs">
                            <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                              {formatUnitPrice(product.sell_price)}
                            </span>
                            <span className={`tabular-nums ${product.stock_quantity <= product.min_stock_level ? 'font-semibold text-red-600' : 'text-gray-500'}`}>
                              ост: {product.stock_quantity}
                            </span>
                          </div>
                          <div className="flex gap-1">
                            <PublishSwitch
                              published={Boolean(product.is_published)}
                              disabled={publishProductMutation.isPending}
                              onToggle={() =>
                                publishProductMutation.mutate({
                                  id: product.id,
                                  is_published: !product.is_published,
                                })
                              }
                            />
                            <button
                              onClick={() => handleEditProduct(product)}
                              className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-text)]"
                              aria-label="Редактировать"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(product.id)}
                              className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-accent)]"
                              aria-label="Удалить"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden bg-[var(--erp-surface)]">
                          <div className={`h-full ${bar.color}`} style={{ width: `${bar.pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <table className="hidden w-full text-sm sm:table">
                  <thead>
                    <tr className="border-b-2 border-[var(--erp-divider)] text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                      <th className="px-4 py-3 text-left font-semibold">Товар</th>
                      <th className="px-4 py-3 text-left font-semibold">Категория</th>
                      <th className="px-4 py-3 text-right font-semibold">Цена</th>
                      <th className="px-4 py-3 text-right font-semibold">Остаток</th>
                      <th className="px-4 py-3 text-left font-semibold">Уровень запаса</th>
                      <th className="px-4 py-3 text-center font-semibold">Маркетплейс</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((product) => {
                      const color = catColor(product.category_id);
                      const bar = stockBar(product);
                      return (
                        <tr
                          key={product.id}
                          className={`group border-b border-[var(--erp-divider)] transition-colors hover:bg-[var(--erp-surface)] ${
                            product.stock_quantity === 0 ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[var(--erp-text)]">{product.name}</div>
                            {product.barcode && (
                              <div className="font-mono text-[11px] text-[var(--erp-muted)]">{product.barcode}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {product.category?.name ? (
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium ${color.badge}`}>
                                <span className={`h-1.5 w-1.5 ${color.dot}`} />
                                {product.category.name}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-[var(--erp-text)]">
                            {formatUnitPrice(product.sell_price)}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${
                            product.stock_quantity === 0
                              ? 'font-semibold text-[var(--erp-accent)]'
                              : product.stock_quantity <= product.min_stock_level
                                ? 'font-semibold text-[var(--erp-accent)]'
                                : 'text-gray-700'
                          }`}>
                            {product.stock_quantity}
                            {product.stock_quantity > 0 && product.stock_quantity <= product.min_stock_level && ' ⚠'}
                            <span className="ml-1 text-[11px] text-[var(--erp-muted)]">{product.uom}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-28 overflow-hidden bg-[var(--erp-surface)]">
                                <div className={`h-full ${bar.color}`} style={{ width: `${bar.pct}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <PublishSwitch
                              published={Boolean(product.is_published)}
                              disabled={publishProductMutation.isPending}
                              onToggle={() =>
                                publishProductMutation.mutate({
                                  id: product.id,
                                  is_published: !product.is_published,
                                })
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            {/* The table starts at 640px, which includes every
                                touch tablet — hover-only actions are invisible
                                there and to keyboard users. */}
                            <div className="flex justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                              <button
                                type="button"
                                onClick={() => handleEditProduct(product)}
                                className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-text)]"
                                aria-label="Редактировать"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(product.id)}
                                className="p-2 text-[var(--erp-muted)] hover:text-[var(--erp-accent)]"
                                aria-label="Удалить"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {showProductModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl max-h-[90vh] overflow-hidden">
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
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Название *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Единица измерения</label>
                  <select
                    value={formData.uom}
                    onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  >
                    <option value="dona">дона (штука)</option>
                    <option value="metr">метр</option>
                    <option value="kg">кг</option>
                    <option value="litr">литр</option>
                    <option value="juft">пара</option>
                    <option value="quti">коробка</option>
                    <option value="komplekt">комплект</option>
                  </select>
                </div>
                <div>
                  {/* Creates in place. Sending the user to the category manager
                      mid-form cost them the form. */}
                  <CategoryPicker
                    value={formData.category_id}
                    categories={sortedCategories}
                    onChange={(categoryId) => setFormData({ ...formData, category_id: categoryId })}
                    onCreated={() => void refreshCategoryData()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCategoryManager(true)}
                    className="mt-2 text-xs text-[var(--erp-accent)] hover:underline sm:text-sm"
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
                    step="0.0001"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Цена продажи *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.0001"
                    value={formData.sell_price}
                    onChange={(e) => setFormData({ ...formData, sell_price: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
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
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Количество *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.001"
                    value={formData.stock_quantity}
                    onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Мин. остаток</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={formData.min_stock_level}
                    onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                    className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 sm:mt-4">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Описание</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full h-16 sm:h-20 px-3 py-2 border border-[var(--erp-divider)] bg-white text-sm resize-none"
                />
              </div>

              {editingProduct && (
                <div className="mt-3 sm:mt-4 border border-[var(--erp-divider)] p-3">
                  <label className="mb-2 block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                    Фото для маркетплейса
                  </label>
                  <div className="flex items-center gap-3">
                    {imagePreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imagePreview}
                        alt="Фото товара"
                        className="h-16 w-16 shrink-0 object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-[var(--erp-surface)] text-[11px] text-[var(--erp-muted)]">
                        Нет фото
                      </div>
                    )}
                    <div className="min-w-0">
                      <label className="inline-flex cursor-pointer items-center border border-[var(--erp-divider)] bg-white px-3 py-2 text-sm text-[var(--erp-text)] hover:border-[var(--erp-text)]">
                        {uploadImageMutation.isPending ? 'Загрузка…' : 'Загрузить фото'}
                        <input
                          type="file"
                          accept="image/*"
                          aria-label="Загрузить фото товара"
                          disabled={uploadImageMutation.isPending}
                          onChange={handleImageSelected}
                          className="hidden"
                        />
                      </label>
                      <p className="mt-1 text-[11px] text-[var(--erp-muted)]">
                        JPG или PNG, до 5&nbsp;МБ. Показывается покупателям в маркетплейсе.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Additional sale units (multi-UOM). Base unit = uom + цена продажи. */}
              <div className="mt-3 sm:mt-4 border border-[var(--erp-divider)] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                    Дополнительные единицы продажи
                  </label>
                  <button
                    type="button"
                    onClick={() => setFormUnits((rows) => [...rows, { ...emptyUnitRow }])}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Добавить
                  </button>
                </div>
                <p className="mb-2 text-[11px] leading-snug text-[var(--erp-muted)]">
                  Тот же остаток продаётся в разных единицах. Коэффициент — сколько «{formData.uom || 'ед.'}» в одной такой единице (напр.: «qop», коэффициент&nbsp;5 = 5&nbsp;{formData.uom || 'ед.'}).
                </p>
                {formUnits.length === 0 ? (
                  <p className="text-[11px] text-[var(--erp-muted)]">Нет доп. единиц — товар продаётся только в «{formData.uom || 'ед.'}».</p>
                ) : (
                  <div className="space-y-2">
                    {formUnits.map((row, index) => (
                      <div key={index} className="grid grid-cols-12 items-center gap-2">
                        <input
                          type="text"
                          placeholder="Название (qop)"
                          value={row.name}
                          onChange={(e) => updateUnitRow(index, 'name', e.target.value)}
                          className="col-span-4 h-9 border border-[var(--erp-divider)] bg-white px-2 text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          placeholder={`× ${formData.uom || 'ед.'}`}
                          title={`Сколько «${formData.uom || 'ед.'}» в одной единице`}
                          value={row.factor}
                          onChange={(e) => updateUnitRow(index, 'factor', e.target.value)}
                          className="col-span-3 h-9 border border-[var(--erp-divider)] bg-white px-2 text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          placeholder="Цена"
                          value={row.sell_price}
                          onChange={(e) => updateUnitRow(index, 'sell_price', e.target.value)}
                          className="col-span-3 h-9 border border-[var(--erp-divider)] bg-white px-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setFormUnits((rows) => rows.filter((_, i) => i !== index))}
                          aria-label="Удалить единицу"
                          className="col-span-2 flex h-9 items-center justify-center text-[var(--erp-muted)] hover:text-[var(--erp-accent)]"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-[var(--erp-surface)] text-sm sm:text-base order-2 sm:order-1"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createProductMutation.isPending || updateProductMutation.isPending}
                  className="px-4 py-2 bg-[var(--erp-accent)] text-white hover:opacity-90 disabled:opacity-50 text-sm sm:text-base order-1 sm:order-2"
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
          <div className="bg-white w-full sm:max-w-3xl max-h-[90vh] overflow-hidden">
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
                className="shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-[var(--erp-accent)] text-white hover:opacity-90 text-sm"
              >
                <PlusIcon className="w-4 h-4" />
                <span>Добавить</span>
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto max-h-[72vh] space-y-3">
              {sortedCategories.length === 0 ? (
                <div className="border border-dashed border-[var(--erp-divider)] p-8 text-center text-gray-500">
                  Категорий пока нет
                </div>
              ) : (
                sortedCategories.map((category) => {
                  const color = catColor(category.id);
                  return (
                    <div
                      key={category.id}
                      className="border border-[var(--erp-divider)] p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`h-2.5 w-2.5 ${color.dot}`} />
                          <p className="font-semibold text-gray-900 dark:text-white">{category.name}</p>
                          {!category.is_active && (
                            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600">
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
                          className="px-3 py-2 text-sm text-[var(--erp-text)] bg-white border border-[var(--erp-divider)] hover:border-[var(--erp-text)]"
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(category)}
                          disabled={deleteCategoryMutation.isPending}
                          className="px-3 py-2 text-sm text-[var(--erp-accent)] bg-white border border-[var(--erp-divider)] hover:border-[var(--erp-accent)] disabled:opacity-50"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCategoryManager(false)}
                className="px-4 py-2 text-gray-600 hover:bg-[var(--erp-surface)] text-sm sm:text-base"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-[70] sm:p-4">
          <div className="bg-white w-full sm:max-w-lg overflow-hidden">
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
                  className="w-full h-9 sm:h-10 px-3 border border-[var(--erp-divider)] bg-white text-sm"
                  placeholder="Например: Напитки"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Описание</label>
                <textarea
                  value={categoryFormData.description}
                  onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
                  className="w-full h-20 px-3 py-2 border border-[var(--erp-divider)] bg-white text-sm resize-none"
                  placeholder="Короткое описание категории"
                />
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCategoryModal}
                  className="px-4 py-2 text-gray-600 hover:bg-[var(--erp-surface)] text-sm sm:text-base"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingCategory}
                  className="px-4 py-2 bg-[var(--erp-accent)] text-white hover:opacity-90 disabled:opacity-50 text-sm sm:text-base"
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

export default function ProductsPage() {
  return (
    <ModuleGuard module="inventory">
      <Products />
    </ModuleGuard>
  );
}
