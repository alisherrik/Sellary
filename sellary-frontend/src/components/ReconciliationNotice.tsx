'use client';

import Link from 'next/link';

import { useReconciledFrom } from '@/lib/store';
import { formatIsoDate } from '@/lib/utils';

/**
 * The reconciliation cut-off, stated on every screen that reads history.
 *
 * `role="status"` and not a toast: this is a standing condition of the view,
 * not something that just happened. It is also purely cosmetic — the session it
 * reads is persisted, so it can be stale in an open tab after another admin
 * reconciles. The server's 409 and the `can_return` flag are the authority.
 */
export default function ReconciliationNotice() {
  const reconciledFrom = useReconciledFrom();
  if (!reconciledFrom) {
    return null;
  }

  return (
    <div
      role="status"
      className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-4"
    >
      <p className="text-[13px] leading-snug text-[var(--erp-text)]">
        Сверка от {formatIsoDate(reconciledFrom)}. Данные до этой даты закрыты: их
        можно смотреть, но не изменять.{' '}
        <Link href="/periods" className="font-medium text-[var(--erp-accent)] hover:underline">
          Отчёты по закрытым периодам
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * The browser's calendar day for an instant, as `YYYY-MM-DD`.
 *
 * Deliberately the browser's clock and not the company's: it is the clock the
 * row's own timestamp is rendered on, so the badge can never contradict the
 * date printed beside it. Which side of the cut-off a document really falls on
 * is decided on the server, on the company clock.
 */
const localDay = (value: string) => {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
};

/**
 * «до сверки» on a row that belongs to the settled period. Renders nothing
 * when there is no cut-off or the row is inside the open one, so a caller drops
 * it in beside the date and holds no date logic of its own.
 */
export function SettledBadge({ at }: { at: string | null | undefined }) {
  const reconciledFrom = useReconciledFrom();
  if (!reconciledFrom || !at) {
    return null;
  }
  const day = localDay(at);
  if (!day || day >= reconciledFrom) {
    return null;
  }

  return (
    <span
      title={`Период закрыт сверкой от ${formatIsoDate(reconciledFrom)}`}
      className="whitespace-nowrap bg-[var(--erp-badge-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--erp-badge-text)]"
    >
      до сверки
    </span>
  );
}
