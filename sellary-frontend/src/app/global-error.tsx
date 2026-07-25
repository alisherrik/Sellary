'use client';

// Last resort: catches failures in the root layout itself, where the normal
// error boundary cannot render. Must supply its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body>
        <div
          role="alert"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            background: '#faf9f7',
            fontFamily: 'system-ui, sans-serif',
            color: '#1a1815',
          }}
        >
          <div style={{ maxWidth: 480, border: '2px solid #e4e0da', background: '#fff', padding: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Приложение не загрузилось</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#4b5563' }}>
              Перезагрузите страницу. Если ошибка повторяется, сообщите администратору.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 20,
                minHeight: 44,
                padding: '0 16px',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 800,
                fontSize: 15,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Повторить
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
