'use client';

interface QueryErrorProps {
  /** What failed to load, in the accusative: «товары», «продажи», «заказы». */
  what: string;
  onRetry?: () => void;
}

/**
 * The queries in this app are gated on server health, so a failed or skipped
 * request arrives at the page as `data = []` with `isLoading = false` — and
 * every list then rendered its empty state. An operator was told their
 * catalogue was empty when the server was simply unreachable. This says which
 * of the two it is.
 */
export default function QueryError({ what, onRetry }: QueryErrorProps) {
  return (
    <div
      role="alert"
      className="border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)] p-4 text-center"
    >
      <p className="text-[15px] font-extrabold text-[var(--erp-text)]">
        Не удалось загрузить {what}
      </p>
      <p className="mt-1 text-[13px] text-[var(--erp-muted)]">
        Проверьте связь с сервером и попробуйте ещё раз.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-[14px] font-extrabold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
        >
          Повторить
        </button>
      )}
    </div>
  );
}
