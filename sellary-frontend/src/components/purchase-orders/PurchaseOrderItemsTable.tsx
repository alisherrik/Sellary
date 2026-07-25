'use client';

import { useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/20/solid';

import {
  createPurchaseOrderItemInput,
  deriveLineTotal,
  deriveUnitCostFromTotal,
  type PurchaseOrderItemErrors,
  type PurchaseOrderItemInput,
} from '@/features/purchase-orders/purchaseOrderForm';
import type { Product } from '@/lib/types';
import ProductCombobox from './ProductCombobox';

interface PurchaseOrderItemsTableProps {
  items: PurchaseOrderItemInput[];
  productsById: Map<number, Product>;
  errors: Record<string, PurchaseOrderItemErrors>;
  onChange: (items: PurchaseOrderItemInput[]) => void;
}

/**
 * Editable line-total cell. Закупка часто оптовая, поэтому пользователь вводит
 * общую сумму, а цена за штуку вычисляется обратно. Источник правды —
 * unit_cost у строки; этот инпут показывает производное qty × unit_cost, но
 * во время ввода держит локальный черновик, чтобы сумма не «прыгала».
 */
function LineTotalInput({
  quantity,
  unitCost,
  ariaLabel,
  hasError,
  onTotalChange,
}: {
  quantity: string;
  unitCost: string;
  ariaLabel: string;
  hasError: boolean;
  onTotalChange: (total: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const derived = deriveLineTotal(quantity, unitCost);
  const displayValue =
    draft !== null ? draft : derived ? String(Math.round(derived * 100) / 100) : '';

  return (
    <input
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={displayValue}
      onChange={(event) => {
        setDraft(event.target.value);
        onTotalChange(event.target.value);
      }}
      onBlur={() => setDraft(null)}
      className={`min-h-11 w-full border bg-white px-3 text-right text-sm font-semibold tabular-nums text-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] ${
        hasError ? 'border-[#dc2626]' : 'border-[var(--erp-divider)]'
      }`}
    />
  );
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
    // No overflow rule at all: a non-visible axis forces the other to auto,
    // and the combobox popup is the one thing that must escape this box. The
    // 758px grid only turns on at xl, where the content column fits it.
    <div>
      <div className="hidden min-w-[758px] grid-cols-[minmax(220px,1fr)_64px_110px_130px_130px_44px] gap-3 border-b border-[var(--erp-divider)] px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)] xl:grid">
        <span>Товар</span>
        <span>Ед.</span>
        <span className="text-right">Количество</span>
        <span className="text-right">Цена</span>
        <span className="text-right">Сумма</span>
        <span className="sr-only">Действия</span>
      </div>

      <div className="divide-y divide-[var(--erp-divider)]">
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

          return (
            <div
              key={item.key}
              data-product-id={item.product_id || undefined}
              className="grid gap-3 py-4 xl:min-w-[758px] xl:grid-cols-[minmax(220px,1fr)_64px_110px_130px_130px_44px] xl:items-start xl:px-3"
            >
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)] xl:hidden">
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
                      // Refuse, and stay put: moving focus to the other row
                      // announced that row's label instead of the reason.
                      return false;
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
                    return true;
                  }}
                />
                {productError && (
                  <p id={`${item.key}-product-error`} className="mt-1 text-xs text-[#dc2626]">
                    {productError}
                  </p>
                )}
              </div>

              <div className="pt-0 text-sm text-[var(--erp-muted)] sm:pt-3">
                <span className="mr-2 text-xs font-medium text-[var(--erp-muted)] xl:hidden">Ед.</span>
                {product?.uom ?? '—'}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)] xl:hidden">
                  Количество
                </span>
                <span className="sr-only">
                  {`Количество, ${product?.name ?? `товар ${index + 1}`}`}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
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
                  className={`min-h-11 w-full border bg-white px-3 text-right text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] ${
                    rowErrors.quantity_ordered ? 'border-[#dc2626]' : 'border-[var(--erp-divider)]'
                  }`}
                />
                {rowErrors.quantity_ordered && (
                  <p id={`${item.key}-quantity-error`} className="mt-1 text-xs text-[#dc2626]">
                    {rowErrors.quantity_ordered}
                  </p>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)] xl:hidden">
                  Цена
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  aria-label={`Цена, ${product?.name ?? `товар ${index + 1}`}`}
                  aria-invalid={Boolean(rowErrors.unit_cost)}
                  aria-describedby={rowErrors.unit_cost ? `${item.key}-cost-error` : undefined}
                  value={item.unit_cost}
                  onChange={(event) => updateRow(item.key, { unit_cost: event.target.value })}
                  className={`min-h-11 w-full border bg-white px-3 text-right text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] ${
                    rowErrors.unit_cost ? 'border-[#dc2626]' : 'border-[var(--erp-divider)]'
                  }`}
                />
                {rowErrors.unit_cost && (
                  <p id={`${item.key}-cost-error`} className="mt-1 text-xs text-[#dc2626]">
                    {rowErrors.unit_cost}
                  </p>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)] xl:hidden">
                  Сумма
                </span>
                <LineTotalInput
                  quantity={item.quantity_ordered}
                  unitCost={item.unit_cost}
                  hasError={Boolean(rowErrors.unit_cost)}
                  ariaLabel={`Сумма, ${product?.name ?? `товар ${index + 1}`}`}
                  onTotalChange={(total) =>
                    updateRow(item.key, {
                      unit_cost: deriveUnitCostFromTotal(total, item.quantity_ordered),
                    })
                  }
                />
              </label>

              <button
                type="button"
                aria-label={`Удалить ${product?.name ?? `товар ${index + 1}`}`}
                onClick={() => removeRow(item.key)}
                className="grid min-h-11 min-w-11 place-items-center text-[var(--erp-muted)] hover:bg-[var(--erp-surface)] hover:text-[#dc2626] focus-visible:outline-none focus-visible:ring-2 focus-visible:outline-[var(--erp-accent)]"
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
        className="mt-3 inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-[var(--erp-accent)] hover:bg-[var(--erp-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:outline-[var(--erp-accent)]"
      >
        <PlusIcon className="h-4 w-4" />
        Добавить товар
      </button>
    </div>
  );
}
