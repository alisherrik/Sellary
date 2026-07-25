/**
 * Shown while the app decides whether there is a session.
 *
 * It exists so a user never sees the answer change under them: no dashboard
 * appearing and then snapping to the login screen, no login form flashing
 * before the app it was about to let them into. Deliberately quiet — a
 * wordmark, not a spinner competing for attention.
 */
export default function SessionSplash({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--erp-bg)]">
      <div className="text-[22px] font-extrabold tracking-tight text-[var(--erp-text)]">
        Sellary
      </div>
      <div className="h-0.5 w-16 overflow-hidden bg-[var(--erp-divider)]">
        <div className="h-full w-1/2 animate-session-sweep bg-[var(--erp-accent)]" />
      </div>
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}
