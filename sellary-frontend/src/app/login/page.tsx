'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  BuildingOffice2Icon,
  EyeIcon,
  EyeSlashIcon,
  ServerIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

import SessionSplash from '@/components/SessionSplash';
import { useAuthStore } from '@/lib/store';
import type { CompanySummary } from '@/lib/types';
import { useServerHealth } from '@/providers/ServerHealthProvider';

// Square and hairline-bordered — the same material logic as the cards and
// header controls in the app shell this screen opens into. Fills come from
// tokens rather than a literal white so the pages stay readable if the theme
// toggle has put `.dark` on <html> before a logout returned the user here.
const FIELD_CLASS =
  'h-11 w-full border border-[var(--erp-divider)] bg-[var(--erp-surface)] px-3 text-[14px] text-[var(--erp-text)] outline-none transition-colors hover:border-[var(--erp-muted)] focus:border-[var(--erp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--erp-accent)]';

const LABEL_CLASS = 'mb-1.5 block text-[13px] font-semibold text-[var(--erp-text)]';

const PRIMARY_BUTTON_CLASS =
  'inline-flex h-11 items-center justify-center bg-[var(--erp-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--erp-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] disabled:cursor-not-allowed disabled:bg-[var(--erp-divider)] disabled:text-[var(--erp-muted)]';

const LOGIN_STEPS = [
  { number: 1, label: 'Вход' },
  { number: 2, label: 'Компания' },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { isServerReachable, isChecking } = useServerHealth();
  const {
    accessToken,
    companies,
    currentCompany,
    hasHydrated,
    login,
    loginToken,
    selectCompany,
  } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectingCompany, setSelectingCompany] = useState(false);
  const [pendingCompanies, setPendingCompanies] = useState<CompanySummary[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  // Step 1's form unmounts on advance, taking the focused submit button with
  // it — focus fell to <body>, so a keyboard user had to Tab from the top of
  // the document to reach the company list.
  const companyStepHeadingRef = useRef<HTMLHeadingElement>(null);

  const isChoosingCompany = useMemo(
    () => !accessToken && !!loginToken && pendingCompanies.length > 0,
    [accessToken, loginToken, pendingCompanies.length],
  );

  useEffect(() => {
    if (isChoosingCompany) {
      companyStepHeadingRef.current?.focus();
    }
  }, [isChoosingCompany]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (accessToken && currentCompany) {
      router.replace('/apps');
    }
  }, [accessToken, currentCompany, hasHydrated, router]);

  useEffect(() => {
    if (!accessToken && loginToken && companies.length > 0) {
      setPendingCompanies(companies);
      setSelectedCompanyId(
        companies.find((company) => company.is_default)?.id ?? companies[0]?.id ?? null,
      );
    }
  }, [accessToken, companies, loginToken]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isServerReachable) {
      toast.error('Сервер недоступен. Вход заблокирован, пока API не вернётся в сеть.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(username, password);
      if (result.requiresCompanySelection) {
        setPendingCompanies(result.companies);
        setSelectedCompanyId(
          result.companies.find((company) => company.is_default)?.id ??
            result.companies[0]?.id ??
            null,
        );
        toast.success('Выберите компанию, в которой хотите работать.');
      } else {
        toast.success('Вход выполнен успешно.');
        router.replace('/apps');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Не удалось войти.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompanySelection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCompanyId) {
      toast.error('Сначала выберите компанию.');
      return;
    }

    setSelectingCompany(true);
    try {
      await selectCompany(selectedCompanyId);
      toast.success('Компания выбрана.');
      router.replace('/apps');
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось открыть эту компанию.',
      );
    } finally {
      setSelectingCompany(false);
    }
  };

  // Nothing renders until we know whether there is a session and whether the
  // API is up. Otherwise an already-signed-in user watched the login form
  // appear and then vanish.
  if (!hasHydrated || isChecking) {
    return (
      <SessionSplash
        label={!hasHydrated ? 'Восстановление сессии' : 'Проверка соединения с сервером'}
      />
    );
  }

  if (!isServerReachable) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--erp-bg)] px-4 py-10">
        <div
          id="main"
          className="w-full max-w-[420px] border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-8 text-center"
        >
          <div className="mx-auto grid h-12 w-12 place-items-center border-2 border-[var(--erp-warn)] bg-[var(--erp-warn-bg)]">
            <ServerIcon className="h-6 w-6 text-[var(--erp-warn)]" />
          </div>
          <h1 className="mt-5 text-[22px] font-extrabold tracking-tight text-[var(--erp-text)]">
            Сервер недоступен
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--erp-muted)]">
            Вход отключён, пока сервер снова не станет доступен.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`mt-6 w-full ${PRIMARY_BUTTON_CLASS}`}
          >
            Повторить подключение
          </button>
        </div>
      </div>
    );
  }

  if (accessToken && currentCompany) {
    return <SessionSplash label="Проверка сессии" />;
  }

  const currentStep = isChoosingCompany ? 2 : 1;

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--erp-bg)] text-[var(--erp-text)] lg:flex-row">
      {/* Brand panel. Same fill and 2px rule as the module rail in the shell,
          so signing in and landing on /apps is one continuous surface. */}
      <aside className="flex flex-none flex-col border-b-2 border-[var(--erp-divider)] bg-[var(--erp-surface)] px-5 py-4 lg:w-[40%] lg:max-w-[520px] lg:border-b-0 lg:border-r-2 lg:px-12 lg:py-12">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 flex-none place-items-center bg-[var(--erp-accent)] lg:h-12 lg:w-12"
          >
            <ShoppingBagIcon className="h-5 w-5 text-white lg:h-6 lg:w-6" />
          </span>
          <span className="text-[19px] font-extrabold tracking-tight lg:text-[26px]">Sellary</span>
        </div>

        <p className="my-auto hidden max-w-[26ch] py-10 text-[20px] font-semibold leading-snug tracking-tight lg:block">
          POS-доступ с учётом компаний, чёткими границами сессий и быстрым переключением.
        </p>

        <div className="hidden border-t border-[var(--erp-divider)] pt-4 lg:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--erp-muted)]">
            Правила сессии
          </div>
          <p className="mt-2 max-w-[44ch] text-[13px] leading-relaxed text-[var(--erp-muted)]">
            Один вход даёт доступ к нескольким компаниям. После входа выберите нужную компанию, и
            Sellary ограничит всю сессию этой компанией.
          </p>
        </div>
      </aside>

      <main
        id="main"
        className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:justify-start lg:px-16"
      >
        <div className="w-full max-w-[400px]">
          <ol className="flex items-center gap-2.5" aria-label="Этапы входа">
            {LOGIN_STEPS.map((step, index) => {
              const isCurrent = currentStep === step.number;
              const isReached = currentStep >= step.number;
              return (
                <li
                  key={step.number}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="flex items-center gap-2.5"
                >
                  {index > 0 && (
                    <span aria-hidden="true" className="h-px w-5 bg-[var(--erp-divider)]" />
                  )}
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 flex-none place-items-center text-[11px] font-extrabold ${
                      isReached
                        ? 'bg-[var(--erp-accent)] text-white'
                        : 'border border-[var(--erp-divider)] text-[var(--erp-muted)]'
                    }`}
                  >
                    {step.number}
                  </span>
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      isCurrent ? 'text-[var(--erp-text)]' : 'text-[var(--erp-muted)]'
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {!isChoosingCompany ? (
            <>
              <h1 className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight">
                Вход
              </h1>
              <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--erp-muted)]">
                Введите данные для входа, чтобы загрузить компании, привязанные к вашему аккаунту.
              </p>

              <form
                onSubmit={handleLogin}
                className="mt-7 flex flex-col gap-4"
                aria-busy={submitting}
              >
                <div>
                  <label htmlFor="login-username" className={LABEL_CLASS}>
                    Имя пользователя
                  </label>
                  <input
                    id="login-username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={FIELD_CLASS}
                    placeholder="admin"
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className={LABEL_CLASS}>
                    Пароль
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
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

                <button
                  type="submit"
                  disabled={submitting}
                  className={`mt-2 w-full ${PRIMARY_BUTTON_CLASS}`}
                >
                  {submitting ? 'Загрузка компаний...' : 'Продолжить'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1
                ref={companyStepHeadingRef}
                tabIndex={-1}
                className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight outline-none"
              >
                Выбор компании
              </h1>
              <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--erp-muted)]">
                Ваши данные загружены. Выберите компанию для этой сессии.
              </p>

              <form onSubmit={handleCompanySelection} className="mt-7" aria-busy={selectingCompany}>
                <div className="flex flex-col gap-2">
                  {pendingCompanies.map((company) => {
                    const checked = selectedCompanyId === company.id;
                    return (
                      <label
                        key={company.id}
                        className={`flex min-h-[44px] cursor-pointer items-start gap-3 border bg-[var(--erp-surface)] p-3.5 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--erp-accent)] ${
                          checked
                            ? 'border-[var(--erp-accent)] ring-1 ring-[var(--erp-accent)]'
                            : 'border-[var(--erp-divider)] hover:border-[var(--erp-muted)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="company"
                          value={company.id}
                          checked={checked}
                          onChange={() => setSelectedCompanyId(company.id)}
                          className="mt-1 h-4 w-4 flex-none accent-[var(--erp-accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <BuildingOffice2Icon
                              aria-hidden="true"
                              className="h-4 w-4 flex-none text-[var(--erp-muted)]"
                            />
                            <span className="truncate text-[14px] font-extrabold tracking-tight">
                              {company.name}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[12.5px] text-[var(--erp-muted)]">
                            {company.slug}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="border border-[var(--erp-divider)] px-2 py-0.5 text-[11px] font-semibold capitalize text-[var(--erp-muted)]">
                              {company.role}
                            </span>
                            {company.is_default && (
                              <span className="bg-[var(--erp-badge-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--erp-badge-text)]">
                                По умолчанию
                              </span>
                            )}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* Primary first on a phone, back-then-forward on a wide
                    screen — the tab order stays left-to-right either way. */}
                <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingCompanies([]);
                      setSelectedCompanyId(null);
                    }}
                    className="inline-flex h-11 w-full items-center justify-center border border-[var(--erp-divider)] bg-[var(--erp-surface)] px-4 text-[14px] font-semibold text-[var(--erp-text)] transition-colors hover:border-[var(--erp-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)] sm:w-28"
                  >
                    Назад
                  </button>
                  <button
                    type="submit"
                    disabled={selectingCompany || selectedCompanyId === null}
                    className={`w-full leading-tight sm:flex-1 ${PRIMARY_BUTTON_CLASS}`}
                  >
                    {selectingCompany ? 'Открытие компании...' : 'Открыть рабочее пространство'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
