'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

import { useShift } from '@/hooks/useQueries';
import { formatDateTime } from '@/lib/utils';
import { ShiftTotalsPanel } from '@/components/shifts/ShiftTotalsPanel';
import { CardSkeleton } from '@/components/skeletons';

export default function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: shift, isLoading } = useShift(Number(id));

  return (
    <div className="h-full overflow-y-auto mobile-no-overscroll p-4 space-y-4">
      <Link href="/shifts" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeftIcon className="h-4 w-4" /> К сменам
      </Link>

      {isLoading || !shift ? (
        <CardSkeleton />
      ) : (
        <>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              Смена №{shift.shift_number}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${shift.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {shift.status === 'open' ? 'Открыта' : 'Закрыта'}
              </span>
            </h1>
            <p className="text-xs text-gray-500">
              Открыта {formatDateTime(shift.opened_at)}
              {shift.closed_at ? ` · Закрыта ${formatDateTime(shift.closed_at)}` : ''}
            </p>
          </div>

          <ShiftTotalsPanel shift={shift} totals={shift.totals} />

          {shift.snapshots.length > 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Срезы</p>
              <ul className="space-y-1 text-sm">
                {shift.snapshots.map((snap) => (
                  <li key={snap.id} className="flex justify-between border-b border-gray-50 py-1 last:border-0 dark:border-gray-700">
                    <span className="text-gray-500">{formatDateTime(snap.taken_at)}</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-200">
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
