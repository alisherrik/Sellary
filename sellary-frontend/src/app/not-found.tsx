import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--erp-bg)] p-4">
      <div className="w-full max-w-[480px] border-2 border-[var(--erp-divider)] bg-white p-6">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-[var(--erp-muted)]">
          404
        </div>
        <h1 className="mt-2 text-[22px] font-extrabold tracking-tight text-[var(--erp-text)]">
          Страница не найдена
        </h1>
        <p className="mt-2 text-[14px] leading-snug text-[var(--erp-muted)]">
          Такого раздела нет — возможно, он был переименован или у вас нет к нему доступа.
        </p>
        <Link
          href="/apps"
          className="mt-5 inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-[15px] font-extrabold text-white hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
        >
          К приложениям
        </Link>
      </div>
    </div>
  );
}
