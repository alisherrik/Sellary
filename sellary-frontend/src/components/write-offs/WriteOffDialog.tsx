'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrashIcon } from '@heroicons/react/24/outline';

import { useDialogFocus } from '@/hooks/useDialogFocus';
import { suppliersApi } from '@/lib/api';
import { REASON_LABELS, REASON_ORDER } from '@/lib/writeOffLabels';
import type { Product, WriteOffDisposition, WriteOffReason } from '@/lib/types';
import ProductCombobox from '@/components/purchase-orders/ProductCombobox';

export interface WriteOffRow {
  product: Product;
  unitId: number | null;
  quantity: string;
}

export interface WriteOffDraft {
  disposition: WriteOffDisposition;
  reasonCode: WriteOffReason;
  supplierId: number | null;
  notes: string;
  rows: WriteOffRow[];
}

export interface WriteOffPayload {
  disposition: WriteOffDisposition;
  reason_code: WriteOffReason;
  supplier_id: number | null;
  notes: string | null;
  items: { product_id: number; product_unit_id: number | null; quantity: string }[];
}

/**
 * The rules the form refuses to submit against, kept as a pure function so they
 * are testable without rendering. The server enforces the same rules — this is
 * the fast, Russian-language version of them.
 */
export function validateWriteOff(
  draft: Pick<WriteOffDraft, 'disposition' | 'supplierId' | 'rows'>,
): string | null {
  const usable = draft.rows.filter((row) => Number(row.quantity) > 0);
  if (usable.length === 0) return 'Добавьте хотя бы один товар';
  if (draft.disposition === 'returned_to_supplier' && !draft.supplierId) {
    return 'Выберите поставщика';
  }
  return null;
}

/** A disposal carries no supplier, whatever was picked before the switch. */
export function buildWriteOffPayload(draft: WriteOffDraft): WriteOffPayload {
  return {
    disposition: draft.disposition,
    reason_code: draft.reasonCode,
    supplier_id: draft.disposition === 'returned_to_supplier' ? draft.supplierId : null,
    notes: draft.notes.trim() || null,
    items: draft.rows
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => ({
        product_id: row.product.id,
        product_unit_id: row.unitId,
        quantity: row.quantity,
      })),
  };
}

const field =
  'h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-900';

const DISPOSITION_TABS: { value: WriteOffDisposition; label: string; hint: string }[] = [
  {
    value: 'disposed',
    label: 'Списание',
    hint: 'Товар выбрасывается. Со склада уходит, деньги не возвращаются — это убыток.',
  },
  {
    value: 'returned_to_supplier',
    label: 'Возврат поставщику',
    hint: 'Товар уходит обратно поставщику. Записывается, кто его забрал; движения денег программа не создаёт — если поставщик вернул деньги, проведите их в разделе «Деньги».',
  },
];

export default function WriteOffDialog({
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  submitting: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: WriteOffPayload) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, true, onClose);

  const [disposition, setDisposition] = useState<WriteOffDisposition>('disposed');
  const [reasonCode, setReasonCode] = useState<WriteOffReason>('spoiled');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<WriteOffRow[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const suppliers = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: async () => (await suppliersApi.getAll()).data as any[],
    enabled: disposition === 'returned_to_supplier',
  });

  const chooseDisposition = (next: WriteOffDisposition) => {
    setDisposition(next);
    // Clearing here is what keeps a stale supplier out of a disposal.
    if (next !== 'returned_to_supplier') setSupplierId(null);
  };

  const addProduct = (product: Product) => {
    if (rows.some((row) => row.product.id === product.id)) return false;
    setRows((current) => [...current, { product, unitId: null, quantity: '1' }]);
    return true;
  };

  const patchRow = (index: number, patch: Partial<WriteOffRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const submit = () => {
    const draft: WriteOffDraft = { disposition, reasonCode, supplierId, notes, rows };
    const problem = validateWriteOff(draft);
    setLocalError(problem);
    if (problem) return;
    onSubmit(buildWriteOffPayload(draft));
  };

  const activeTab = DISPOSITION_TABS.find((tab) => tab.value === disposition)!;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Новый акт списания"
        className="w-full max-w-3xl border-2 border-[var(--erp-divider)] bg-white p-5 dark:bg-gray-800"
      >
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--erp-text)] dark:text-white">
          Новый акт
        </h3>

        <div className="mt-4 flex gap-2">
          {DISPOSITION_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => chooseDisposition(tab.value)}
              aria-pressed={disposition === tab.value}
              className={`h-10 flex-1 border px-4 text-sm font-semibold ${
                disposition === tab.value
                  ? 'border-[var(--erp-accent)] bg-[var(--erp-accent)] text-white'
                  : 'border-[var(--erp-divider)] bg-white text-[var(--erp-text)] dark:bg-gray-900 dark:text-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--erp-muted)]">{activeTab.hint}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)]">Причина</span>
            <select
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value as WriteOffReason)}
              className={field}
            >
              {REASON_ORDER.map((code) => (
                <option key={code} value={code}>
                  {REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </label>

          {disposition === 'returned_to_supplier' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)]">
                Поставщик
              </span>
              <select
                value={supplierId ?? ''}
                onChange={(event) =>
                  setSupplierId(event.target.value ? Number(event.target.value) : null)
                }
                className={field}
              >
                <option value="">Выберите поставщика</option>
                {(suppliers.data ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-4">
          <ProductCombobox
            value={null}
            excludedProductIds={new Set(rows.map((row) => row.product.id))}
            onSelect={addProduct}
            label="Добавить товар"
          />
        </div>

        {rows.length > 0 && (
          <div className="mt-3 overflow-x-auto border border-[var(--erp-divider)]">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--erp-divider)] text-left text-[10.5px] uppercase tracking-wide text-[var(--erp-muted)]">
                  <th className="px-3 py-2">Товар</th>
                  <th className="px-3 py-2 w-28">Кол-во</th>
                  <th className="px-3 py-2 w-36">Единица</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.product.id} className="border-b border-[var(--erp-divider)]">
                    <td className="px-3 py-2">{row.product.name}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        aria-label={`Количество: ${row.product.name}`}
                        value={row.quantity}
                        onChange={(event) => patchRow(index, { quantity: event.target.value })}
                        className="h-9 w-full border border-[var(--erp-divider)] bg-white px-2 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Единица: ${row.product.name}`}
                        value={row.unitId ?? ''}
                        onChange={(event) =>
                          patchRow(index, {
                            unitId: event.target.value ? Number(event.target.value) : null,
                          })
                        }
                        className="h-9 w-full border border-[var(--erp-divider)] bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                      >
                        <option value="">{row.product.uom}</option>
                        {(row.product.units ?? [])
                          .filter((unit) => unit.is_active !== false)
                          .map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`Убрать ${row.product.name}`}
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                        className="grid h-9 w-9 place-items-center border border-[var(--erp-divider)]"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-[var(--erp-muted)]">
            Комментарий
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            className="w-full border border-[var(--erp-divider)] bg-white p-3 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </label>

        {(localError || error) && (
          <p className="mt-3 text-sm text-red-600">{localError || error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 border border-[var(--erp-divider)] px-4 text-sm font-medium"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="h-10 bg-[var(--erp-accent)] px-5 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? 'Списываем…' : 'Списать'}
          </button>
        </div>
      </div>
    </div>
  );
}
