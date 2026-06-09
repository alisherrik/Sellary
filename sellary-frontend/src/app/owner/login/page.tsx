'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { EyeIcon, EyeSlashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

import { useOwnerStore } from '@/lib/owner-store';

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">
        Восстановление сессии владельца...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,_#020617,_#0f172a_45%,_#1d4ed8)] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[32px] border border-white/10 bg-white shadow-2xl lg:grid-cols-[1fr_0.9fr]">
          <div className="hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                <ShieldCheckIcon className="h-8 w-8" />
              </div>
              <h1 className="mt-8 text-4xl font-black tracking-tight">Владелец Sellary</h1>
              <p className="mt-4 max-w-sm text-sm leading-7 text-slate-300">
                Глобальное управление компаниями, участниками и вход только для владельца в сессии
                арендаторов.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Доступ</p>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                Этот вход предназначен для владельца приложения и не открывает сессию компании, пока
                вы явно не войдёте в неё из панели.
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">
                Доступ владельца
              </p>
              <h2 className="mt-2 text-3xl font-bold text-slate-900">Вход в панель управления</h2>
              <p className="mt-2 text-sm text-slate-500">
                Используйте учётные данные суперадминистратора из переменных окружения.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Имя пользователя</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-sky-500 focus:bg-white"
                  placeholder="owner"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Пароль</span>
                <div className="relative">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 pr-12 text-sm outline-none transition focus:border-sky-500 focus:bg-white"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-700"
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {submitting ? 'Вход...' : 'Войти'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
