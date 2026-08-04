'use client';

/**
 * A physical count, as a document.
 *
 * The product edit form used to carry a stock box. Changing it posted an
 * inventory adjustment computed as a delta against the cached quantity and
 * stamped «Корректировка остатка при редактировании товара» — 146 such rows
 * reached production, many of them zeroing a product outright, none of them
 * saying why. The delta was applied to whatever the server held at the time,
 * so a page left open while the cashier sold turned a typed figure into a
 * wrong one.
 *
 * This sends an absolute count plus the quantity it was opened on, so the
 * server refuses (409) rather than correcting a number that moved. Known
 * causes — spoilage, breakage, a supplier return — belong to the write-off
 * document, which records disposition and consumed cost; the reasons here are
 * only what counting itself can tell you.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { useDialogFocus } from '@/hooks/useDialogFocus';
import { inventoryApi, productsApi } from '@/lib/api';
import type { Product, StocktakeReason } from '@/lib/types';

const REASONS: { value: StocktakeReason; label: string }[] = [
  { value: 'stocktake', label: 'Инвентаризация (пересчёт)' },
  { value: 'surplus', label: 'Излишек (нашёлся товар)' },
  { value: 'shortage', label: 'Недостача' },
  { value: 'other', label: 'Прочее' },
];

interface StocktakeModalProps {
  product: Product;
  onClose: () => void;
}

/** Trim the API's Numeric(10,3) padding: "51.000" -> "51". */
function formatQuantity(value: number | string): string {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return '0';
  return String(parseFloat(numeric.toFixed(3)));
}

export default function StocktakeModal({ product, onClose }: StocktakeModalProps) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // The list this opened from is cached, so its quantity may already be stale.
  // Refetch before using it as the concurrency token.
  const [expected, setExpected] = useState<number>(product.stock_quantity);
  const [isLoadingExpected, setIsLoadingExpected] = useState(true);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState<StocktakeReason>('stocktake');
  const [note, setNote] = useState('');

  useEffect(() => setMounted(true), []);
  useDialogFocus(panelRef, mounted, onClose);

  useEffect(() => {
    if (!mounted) return;
    const main = document.getElementById('main');
    main?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      main?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    let cancelled = false;
    productsApi
      .getById(product.id)
      .then((response) => {
        if (!cancelled) setExpected(response.data.stock_quantity);
      })
      .catch(() => {
        // Fall back to the list value; a mismatch still surfaces as a 409.
      })
      .finally(() => {
        if (!cancelled) setIsLoadingExpected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  const countedNumber = counted.trim() === '' ? null : Number(counted);
  const hasCount = countedNumber !== null && !Number.isNaN(countedNumber);
  const delta = hasCount ? (countedNumber as number) - expected : null;

  const stocktakeMutation = useMutation({
    mutationFn: () =>
      inventoryApi.stocktake({
        product_id: product.id,
        counted_quantity: String(countedNumber),
        expected_quantity: String(expected),
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventoryLogs', product.id] });
      const applied = Number(response.data?.delta ?? 0);
      toast.success(
        applied === 0
          ? 'Остаток подтверждён без изменений'
          : `Остаток обновлён: ${formatQuantity(response.data.new_quantity)} ${product.uom}`,
      );
      onClose();
    },
    onError: (error: any) => {
      if (error.response?.status === 409) {
        // Sold or received while this was open. Re-seed and make the operator
        // re-confirm rather than correcting a figure that has since moved.
        const current = error.response.headers?.['x-current-quantity'];
        if (current !== undefined) setExpected(Number(current));
        queryClient.invalidateQueries({ queryKey: ['products'] });
        toast.error(
          error.response.data?.detail ||
            'Остаток изменился. Проверьте количество и повторите.',
        );
        return;
      }
      toast.error(error.response?.data?.detail || 'Не удалось сохранить остаток');
    },
  });

  const canSubmit =
    !isLoadingExpected &&
    hasCount &&
    (countedNumber as number) >= 0 &&
    !stocktakeMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    stocktakeMutation.mutate();
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Корректировка остатка: ${product.name}`}
        tabIndex={-1}
        className="relative w-full max-w-[460px] border-2 border-[var(--erp-divider)] bg-white outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-[var(--erp-divider)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--erp-muted)]">
              Корректировка остатка
            </div>
            <h2 className="truncate text-[18px] font-extrabold tracking-tight text-[var(--erp-text)]">
              {product.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4">
          <div className="flex items-center justify-between border-2 border-[var(--erp-divider)] bg-[var(--erp-surface)] px-3 py-2">
            <span className="text-[13px] text-[var(--erp-muted)]">Остаток в системе</span>
            <span
              className="text-[15px] font-extrabold text-[var(--erp-text)]"
              data-testid="stocktake-expected"
            >
              {isLoadingExpected ? '…' : `${formatQuantity(expected)} ${product.uom}`}
            </span>
          </div>

          <div className="mt-3">
            <label
              htmlFor="stocktake-counted"
              className="mb-1 block text-xs font-medium text-[var(--erp-text)] sm:text-sm"
            >
              Фактическое количество *
            </label>
            <input
              id="stocktake-counted"
              type="number"
              required
              min="0"
              step="0.001"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="h-10 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm"
            />
          </div>

          {delta !== null && (
            <div className="mt-2 text-[13px]" data-testid="stocktake-delta" aria-live="polite">
              {delta === 0 ? (
                <span className="text-[var(--erp-muted)]">
                  Расхождения нет — запись в журнал не добавится
                </span>
              ) : (
                <span className={delta > 0 ? 'text-green-700' : 'text-[var(--erp-accent)]'}>
                  Расхождение: {delta > 0 ? '+' : ''}
                  {formatQuantity(delta)} {product.uom}
                </span>
              )}
            </div>
          )}

          <div className="mt-3">
            <label
              htmlFor="stocktake-reason"
              className="mb-1 block text-xs font-medium text-[var(--erp-text)] sm:text-sm"
            >
              Причина *
            </label>
            <select
              id="stocktake-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as StocktakeReason)}
              className="h-10 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm"
            >
              {REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] text-[var(--erp-muted)]">
              Порчу, бой и возврат поставщику оформляйте списанием — там фиксируется
              себестоимость и что стало с товаром.
            </p>
          </div>

          <div className="mt-3">
            <label
              htmlFor="stocktake-note"
              className="mb-1 block text-xs font-medium text-[var(--erp-text)] sm:text-sm"
            >
              Комментарий
            </label>
            <input
              id="stocktake-note"
              type="text"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: пересчёт 04.08, 6 шт нашлись в коробке"
              className="h-10 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm"
            />
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 border-2 border-[var(--erp-divider)] text-sm font-bold text-[var(--erp-text)]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-10 flex-1 bg-[var(--erp-text)] text-sm font-bold text-white disabled:opacity-50"
            >
              {stocktakeMutation.isPending ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
