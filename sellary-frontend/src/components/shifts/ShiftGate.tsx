'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { LockClosedIcon } from '@heroicons/react/24/outline';

import { shiftsApi } from '@/lib/api';
import { useCurrentShift, useShifts } from '@/hooks/useQueries';
import { formatMoney } from '@/lib/utils';

/**
 * The POS shift gate. A sale needs an open till shift, so when none is open this
 * blocks checkout and offers to open one (with the starting cash float). It also
 * exposes `hasOpenShift` to the parent so the pay button can disable itself.
 *
 * The gate is intentionally forgiving: forgetting to open a shift must be one
 * click to fix, never a dead end. The server is the real guard (POST /api/sales
 * returns 409); this is the friendly front for it.
 */
export function ShiftGateBanner() {
  const { data: shift, isSuccess } = useCurrentShift();
  const { data: shifts = [] } = useShifts({ limit: 5 });
  const queryClient = useQueryClient();
  // Empty, not '0'. The field defaulted to zero and the button accepted it, so
  // one shift went into production opened at 0.00 — every cash figure it
  // produced was measured from a starting point nobody had checked.
  const [openingCash, setOpeningCash] = useState('');
  const lastClosed = shifts.find((s) => s.status === 'closed' && s.counted_cash != null);

  const openMutation = useMutation({
    mutationFn: () => shiftsApi.open(openingCash || '0'),
    onSuccess: () => {
      toast.success('Смена открыта');
      queryClient.invalidateQueries({ queryKey: ['currentShift'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'Не удалось открыть смену');
    },
  });

  // Show only when the server has definitively told us no shift is open. While
  // the query is loading, disabled (no company / server unreachable), or errored
  // we stay quiet — the server's 409 on POST /api/sales is the real guard.
  if (!isSuccess || shift) return null;

  return (
    <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20">
      <div className="flex flex-wrap items-center gap-3">
        <LockClosedIcon className="h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Смена не открыта
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Пересчитайте наличные в кассе и укажите сумму на начало — от неё
            будет считаться вся смена.
          </p>
          {lastClosed && (
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
              Смена №{lastClosed.shift_number} закрылась с{' '}
              {formatMoney(lastClosed.counted_cash ?? '0')}.{' '}
              <button
                type="button"
                onClick={() => setOpeningCash(String(lastClosed.counted_cash ?? '0'))}
                className="font-semibold underline"
              >
                Подставить
              </button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            placeholder="Наличные в кассе"
            aria-label="Наличные в кассе на начало смены"
            className="h-11 w-32 rounded-lg border border-amber-300 bg-white px-3 text-sm tabular-nums dark:border-amber-700 dark:bg-gray-800"
          />
          <button
            onClick={() => openMutation.mutate()}
            disabled={openMutation.isPending || openingCash.trim() === ''}
            className="h-11 shrink-0 rounded-lg bg-[var(--erp-accent)] px-4 text-sm font-medium text-white hover:bg-[var(--erp-accent-strong)] disabled:opacity-60"
          >
            Открыть смену
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the POS should allow checkout. Blocks ONLY when the server has
 * confirmed there is no open shift; while the query is loading, disabled, or
 * errored it stays permissive and lets the server's 409 be the real guard —
 * never a dead pay button on a transient state.
 */
export function useHasOpenShift(): boolean {
  const { data: shift, isSuccess } = useCurrentShift();
  const definitelyNoShift = isSuccess && !shift;
  return !definitelyNoShift;
}
