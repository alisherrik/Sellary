'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { VoidPreview } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface AnnulmentDialogProps {
  open: boolean;
  title: string;
  preview: VoidPreview | null;
  loading?: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export default function AnnulmentDialog({
  open,
  title,
  preview,
  loading = false,
  submitting = false,
  onClose,
  onConfirm,
}: AnnulmentDialogProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-gray-800 sm:rounded-2xl">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">Операция останется в истории и будет помечена как аннулированная.</p>

        {loading ? (
          <div className="my-8 text-center text-sm text-gray-500">Проверяем связанные операции...</div>
        ) : preview ? (
          <>
            {preview.impacts.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Изменение склада</h3>
                <div className="mt-2 divide-y rounded-lg border border-gray-200 dark:border-gray-700">
                  {preview.impacts.map((impact) => (
                    <div key={impact.product_id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">{impact.product_name}</span>
                      <span className="shrink-0 text-right font-semibold tabular-nums">
                        {Number(impact.quantity_change) > 0 ? '+' : ''}{impact.quantity_change} шт.
                        <span className="block text-xs font-normal text-gray-500">Остаток: {impact.resulting_stock}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.blockers.length > 0 && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <h3 className="font-semibold">Сначала отмените связанные операции</h3>
                <div className="mt-2 space-y-2">
                  {preview.blockers.map((blocker, index) => (
                    <div key={`${blocker.blocker_type}-${blocker.reference_id}-${index}`}>
                      <p>{blocker.message}</p>
                      {blocker.blocker_type === 'sale' && blocker.reference_id && (
                        <Link className="font-semibold underline" href={`/sales?saleId=${blocker.reference_id}`}>
                          Открыть продажу #{blocker.reference_id}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.is_legacy && (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Это старая операция без полной складской истории. Автоматическое аннулирование ограничено.
              </p>
            )}

            <label className="mt-5 block text-sm font-semibold text-gray-800 dark:text-gray-200">
              Причина аннулирования
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Например: тестовая операция"
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal text-gray-900 outline-none focus:border-red-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              />
            </label>

            {preview.impacts.some((impact) => Number(impact.value_change) !== 0) && (
              <p className="mt-2 text-xs text-gray-500">
                Изменение стоимости запасов: {formatCurrency(preview.impacts.reduce((sum, item) => sum + Number(item.value_change), 0))}
              </p>
            )}
          </>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700">
            Закрыть
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!preview?.can_void || reason.trim().length < 3 || submitting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Аннулируем...' : 'Подтвердить аннулирование'}
          </button>
        </div>
      </div>
    </div>
  );
}
