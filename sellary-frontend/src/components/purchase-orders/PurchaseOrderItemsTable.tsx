'use client';

import { useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/20/solid';

import {
  createPurchaseOrderItemInput,
  type PurchaseOrderItemErrors,
  type PurchaseOrderItemInput,
} from '@/features/purchase-orders/purchaseOrderForm';
import type { Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import ProductCombobox from './ProductCombobox';

interface PurchaseOrderItemsTableProps {
  items: PurchaseOrderItemInput[];
  productsById: Map<number, Product>;
  errors: Record<string, PurchaseOrderItemErrors>;
  onChange: (items: PurchaseOrderItemInput[]) => void;
}

export default function PurchaseOrderItemsTable({
  items,
  productsById,
  errors,
  onChange,
}: PurchaseOrderItemsTableProps) {
  const [resolvedProducts, setResolvedProducts] = useState(productsById);
  const [duplicateRow, setDuplicateRow] = useState<string | null>(null);
  const updateRow = (key: string, changes: Partial<PurchaseOrderItemInput>) => {
    onChange(items.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  };

  const removeRow = (key: string) => {
    if (items.length === 1) {
      onChange([{ ...createPurchaseOrderItemInput(), key }]);
      return;
    }
    onChange(items.filter((item) => item.key !== key));
  };

  return (
    <div>
      <div className="hidden grid-cols-[minmax(220px,1fr)_64px_110px_130px_130px_44px] gap-3 border-b border-gray-200 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid">
        <span>Товар</span>
        <span>Ед.</span>
        <span className="text-right">Количество</span>
        <span className="text-right">Цена</span>
        <span className="text-right">Сумма</span>
        <span className="sr-only">Действия</span>
      </div>

      <div className="divide-y divide-gray-200">
        {items.map((item, index) => {
          const productId = Number(item.product_id);
          const excludedProductIds = new Set(
            items
              .filter((candidate) => candidate.key !== item.key)
              .map((candidate) => Number(candidate.product_id))
              .filter(Boolean),
          );
          const product =
            resolvedProducts.get(productId) ??
            (productId && item.product_name
              ? {
                  id: productId,
                  barcode: null,
                  name: item.product_name,
                  product_type: 'item' as const,
                  uom: item.product_uom ?? 'шт',
                  cost_price: item.unit_cost,
                  sell_price: '0',
                  tax_percent: '0',
                  stock_quantity: 0,
                  min_stock_level: 0,
                  is_active: true,
                  created_at: '',
                }
              : null);
          const rowErrors = errors[item.key] ?? {};
          const productError =
            duplicateRow === item.key ? 'Товар уже добавлен' : rowErrors.product_id;
          const subtotal =
            (Number(item.quantity_ordered) || 0) * (Number(item.unit_cost) || 0);

          return (
            <div
              key={item.key}
              data-product-id={item.product_id || undefined}
              className="grid gap-3 py-4 sm:grid-cols-[minmax(220px,1fr)_64px_110px_130px_130px_44px] sm:items-start sm:px-3"
            >
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-600 sm:hidden">
                  Товар
                </span>
                <ProductCombobox
                  value={product}
                  excludedProductIds={excludedProductIds}
                  error={productError}
                  errorId={`${item.key}-product-error`}
                  label={`Товар ${index + 1}`}
                  onSelect={(selected) => {
                    const duplicate = items.some(
                      (candidate) =>
                        candidate.key !== item.key &&
                        Number(candidate.product_id) === selected.id,
                    );
                    if (duplicate) {
                      setDuplicateRow(item.key);
                      document
                        .querySelector<HTMLElement>(`[data-product-id="${selected.id}"] input`)
                        ?.focus();
                      return;
                    }
                    setDuplicateRow(null);
                    setResolvedProducts((current) => {
                      const next = new Map(current);
                      next.set(selected.id, selected);
                      return next;
                    });
                    updateRow(item.key, {
                      product_id: String(selected.id),
                      product_name: selected.name,
                      product_uom: selected.uom,
                      unit_cost: selected.cost_price,
                    });
                  }}
                />
                {productError && (
                  <p id={`${item.key}-product-error`} className="mt-1 text-xs text-red-600">
                    {productError}
                  </p>
                )}
              </div>

              <div className="pt-0 text-sm text-gray-600 sm:pt-3">
                <span className="mr-2 text-xs font-medium text-gray-500 sm:hidden">Ед.</span>
                {product?.uom ?? '—'}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 sm:hidden">
                  Количество
                </span>
                <span className="sr-only">
                  {`Количество, ${product?.name ?? `товар ${index + 1}`}`}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  aria-label={`Количество, ${product?.name ?? `товар ${index + 1}`}`}
                  aria-invalid={Boolean(rowErrors.quantity_ordered)}
                  aria-describedby={
                    rowErrors.quantity_ordered ? `${item.key}-quantity-error` : undefined
                  }
                  value={item.quantity_ordered}
                  onChange={(event) =>
                    updateRow(item.key, { quantity_ordered: event.target.value })
                  }
                  className={`min-h-11 w-full rounded-md border bg-white px-3 text-right text-sm tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                    rowErrors.quantity_ordered ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {rowErrors.quantity_ordered && (
                  <p id={`${item.key}-quantity-error`} className="mt-1 text-xs text-red-600">
                    {rowErrors.quantity_ordered}
                  </p>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 sm:hidden">
                  Цена
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={`Цена, ${product?.name ?? `товар ${index + 1}`}`}
                  aria-invalid={Boolean(rowErrors.unit_cost)}
                  aria-describedby={rowErrors.unit_cost ? `${item.key}-cost-error` : undefined}
                  value={item.unit_cost}
                  onChange={(event) => updateRow(item.key, { unit_cost: event.target.value })}
                  className={`min-h-11 w-full rounded-md border bg-white px-3 text-right text-sm tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                    rowErrors.unit_cost ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {rowErrors.unit_cost && (
                  <p id={`${item.key}-cost-error`} className="mt-1 text-xs text-red-600">
                    {rowErrors.unit_cost}
                  </p>
                )}
              </label>

              <div className="flex min-h-11 items-center justify-between text-sm font-semibold tabular-nums text-gray-900 sm:justify-end">
                <span className="text-xs font-medium text-gray-500 sm:hidden">Сумма</span>
                {formatCurrency(subtotal)}
              </div>

              <button
                type="button"
                aria-label={`Удалить ${product?.name ?? `товар ${index + 1}`}`}
                onClick={() => removeRow(item.key)}
                className="grid min-h-11 min-w-11 place-items-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <TrashIcon className="h-5 w-5" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onChange([...items, createPurchaseOrderItemInput()])}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <PlusIcon className="h-4 w-4" />
        Добавить товар
      </button>
    </div>
  );
}
