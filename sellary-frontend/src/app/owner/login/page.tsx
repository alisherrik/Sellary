'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { EyeIcon, EyeSlashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

import SessionSplash from '@/components/SessionSplash';
import { useOwnerStore } from '@/lib/owner-store';

// Deliberately identical to /login: same square hairline material, same tokens.
// The owner panel is the same product's back door, not a second app.
const FIELD_CLASS =
  'h-11 w-full border border-[var(--erp-divider)] bg-[var(--erp-surface)] px-3 text-[14px] text-[var(--erp-text)] outline-none transition-colors hover:border-[var(--erp-muted)] focus:border-[var(--erp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--erp-accent)]';

const LABEL_CLASS = 'mb-1.5 block text-[13px] font-semibold text-[var(--erp-text)]';

const PRIMARY_BUTTON_CLASS =
  'inline-flex h-11 w-full items-center justify-center bg-[var(--erp-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] disabled:cursor-not-allowed disabled:bg-[var(--erp-divider)] disabled:text-[var(--erp-muted)]';

export default function OwnerLoginPage() {
  const router = useRouter();
  const { accessToken, isAuthenticated, login, hasHydrated } = useOwnerStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (accessToken && isAuthenticated) {
      router.replace('/owner');
    }
  }, [accessToken, hasHydrated, isAuthenticated, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(username, password);
      toast.success('Сессия владельца открыта.');
      router.replace('/owner');
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Не удалось войти как владелец.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasHydrated) {
    return <SessionSplash label="Восстановление сессии владельца" />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--erp-bg)] text-[var(--erp-text)] lg:flex-row">
      <aside className="flex flex-none flex-col border-b-2 border-[var(--erp-divider)] bg-[var(--erp-surface)] px-5 py-4 lg:w-[40%] lg:max-w-[520px] lg:border-b-0 lg:border-r-2 lg:px-12 lg:py-12">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 flex-none place-items-center bg-[var(--erp-accent)] lg:h-12 lg:w-12"
          >
            <ShieldCheckIcon className="h-5 w-5 text-white lg:h-6 lg:w-6" />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[19px] font-extrabold tracking-tight lg:text-[26px]">Sellary</span>
            <span className="bg-[var(--erp-badge-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--erp-badge-text)]">
              Владелец
            </span>
          </span>
        </div>

        <p className="my-auto hidden max-w-[26ch] py-10 text-[20px] font-semibold leading-snug tracking-tight lg:block">
          Глобальное управление компаниями, участниками и вход только для владельца в сессии
          арендаторов.
        </p>

        <div className="hidden border-t border-[var(--erp-divider)] pt-4 lg:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--erp-muted)]">
            Доступ
          </div>
          <p className="mt-2 max-w-[44ch] text-[13px] leading-relaxed text-[var(--erp-muted)]">
            Этот вход предназначен для владельца приложения и не открывает сессию компании, пока вы
            явно не войдёте в неё из панели.
          </p>
        </div>
      </aside>

      <main
        id="main"
        className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:justify-start lg:px-16"
      >
        <div className="w-full max-w-[400px]">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 flex-none bg-[var(--erp-accent)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--erp-muted)]">
              Доступ владельца
            </span>
          </div>

          <h1 className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight">
            Вход в панель управления
          </h1>
          <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--erp-muted)]">
            Используйте учётные данные суперадминистратора из переменных окружения.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-7 flex flex-col gap-4"
            aria-busy={submitting}
          >
            <div>
              <label htmlFor="owner-username" className={LABEL_CLASS}>
                Имя пользователя
              </label>
              <input
                id="owner-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={FIELD_CLASS}
                placeholder="owner"
              />
            </div>

            <div>
              <label htmlFor="owner-password" className={LABEL_CLASS}>
                Пароль
              </label>
              <div className="relative">
                <input
                  id="owner-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`${FIELD_CLASS} pr-12`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--erp-muted)] transition-colors hover:text-[var(--erp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting} className={`mt-2 ${PRIMARY_BUTTON_CLASS}`}>
              {submitting ? 'Вход…' : 'Войти'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
