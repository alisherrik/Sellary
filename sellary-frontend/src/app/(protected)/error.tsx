'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Without this boundary a thrown render error in any client page — and every
 * page here is a client component — replaced the whole document with Next's
 * English production fallback, taking the shell and the cashier's way back
 * with it. Here the failure stays inside the content pane.
 */
export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div
        role="alert"
        className="w-full max-w-[520px] border-2 border-[var(--erp-divider)] bg-white p-6"
      >
        <div className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-[var(--erp-warn)]">
          Ошибка
        </div>
        <h1 className="mt-2 text-[22px] font-extrabold tracking-tight text-[var(--erp-text)]">
          Страница не открылась
        </h1>
        <p className="mt-2 text-[14px] leading-snug text-[var(--erp-muted)]">
          Что-то пошло не так при отображении этого раздела. Данные не потеряны — попробуйте
          открыть его ещё раз.
        </p>
        {error.digest && (
          <p className="mt-2 text-[12px] text-[var(--erp-muted)]">Код: {error.digest}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-[15px] font-extrabold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
          >
            Повторить
          </button>
          <Link
            href="/apps"
            className="flex min-h-[44px] items-center border-2 border-[var(--erp-divider)] px-4 text-[15px] font-extrabold text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
          >
            К приложениям
          </Link>
        </div>
      </div>
    </div>
  );
}
