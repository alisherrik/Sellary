'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

import { useShift } from '@/hooks/useQueries';
import { formatDateTime } from '@/lib/utils';
import { ShiftTotalsPanel } from '@/components/shifts/ShiftTotalsPanel';
import { CardSkeleton } from '@/components/skeletons';
import QueryError from '@/components/ui/QueryError';

export default function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: shift, isLoading, isError, refetch } = useShift(Number(id));

  return (
    <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
      <Link href="/shifts" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeftIcon className="h-4 w-4" /> К сменам
      </Link>

      {isLoading ? (
        <CardSkeleton />
      ) : isError || !shift ? (
        // `isLoading || !shift` spun forever on a 404 or a failed request: the
        // query settles, the data never arrives, and the skeleton never leaves.
        <QueryError what="смену" onRetry={() => void refetch()} />
      ) : (
        <>
          <div>
            <h2 className="text-[28px] font-extrabold tracking-tight text-[var(--erp-text)]">
              Смена №{shift.shift_number}
              <span className={`ml-2 px-2 py-0.5 text-xs font-medium ${shift.status === 'open' ? 'bg-green-50 text-[var(--erp-success)]' : 'bg-gray-100 text-gray-600'}`}>
                {shift.status === 'open' ? 'Открыта' : 'Закрыта'}
              </span>
            </h2>
            <p className="text-xs text-gray-500">
              Открыта {formatDateTime(shift.opened_at)}
              {shift.closed_at ? ` · Закрыта ${formatDateTime(shift.closed_at)}` : ''}
            </p>
          </div>

          <ShiftTotalsPanel shift={shift} totals={shift.totals} />

          {shift.snapshots.length > 0 && (
            <div className="border border-[var(--erp-divider)] bg-white p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">Срезы</p>
              <ul className="space-y-1 text-sm">
                {shift.snapshots.map((snap) => (
                  <li key={snap.id} className="flex justify-between border-b border-[var(--erp-divider)] py-1 last:border-0">
                    <span className="text-gray-500">{formatDateTime(snap.taken_at)}</span>
                    <span className="tabular-nums text-gray-700">
                      ожидалось {snap.totals.expected_cash}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
