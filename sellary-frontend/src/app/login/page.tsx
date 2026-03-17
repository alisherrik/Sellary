'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ShoppingBagIcon,
  EyeIcon,
  EyeSlashIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '@/lib/store';
import { useServerHealth } from '@/providers/ServerHealthProvider';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login, token } = useAuthStore();
  const { isServerReachable, isChecking } = useServerHealth();

  useEffect(() => {
    if (token) {
      router.push('/pos');
    }
  }, [token, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isServerReachable) {
      toast.error('Сервер недоступен. Вход невозможен.');
      return;
    }

    setLoading(true);

    try {
      await login(username, password);
      toast.success('Вход выполнен успешно');
      router.push('/pos');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 px-4">
        <div className="text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-white"></div>
          </div>
          <p className="text-lg font-medium text-white">Подключение к серверу...</p>
        </div>
      </div>
    );
  }

  if (!isServerReachable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-600 via-gray-700 to-gray-800 px-4 py-8">
        <div className="w-full max-w-sm text-center">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-red-500/20 backdrop-blur-sm">
            <ServerIcon className="h-10 w-10 text-red-400" />
          </div>

          <h1 className="mb-3 text-3xl font-black text-white">Сервер недоступен</h1>
          <p className="mb-8 text-base text-gray-300">
            Не удалось подключиться к серверу. Проверьте сеть или попробуйте позже.
          </p>

          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-bold text-gray-800 shadow-lg transition-all hover:bg-gray-100"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Повторить
          </button>

          <p className="mt-8 text-sm text-gray-400">© 2024 Sellary POS</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center sm:mb-8">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm sm:h-20 sm:w-20">
            <ShoppingBagIcon className="h-10 w-10 text-white sm:h-12 sm:w-12" />
          </div>
          <h1 className="text-2xl font-black text-white sm:text-3xl">Sellary</h1>
          <p className="mt-1 text-sm text-blue-100 sm:text-base">Система управления продажами</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800 sm:p-8">
          <div className="mb-5 flex items-center justify-center sm:mb-6">
            <div className="mr-2 h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
            <h2 className="text-center text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
              Войти в аккаунт
            </h2>
            <div className="ml-2 h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm"
              >
                Имя пользователя
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 sm:h-12 sm:px-4 sm:text-base"
                placeholder="admin"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:text-sm"
              >
                Пароль
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 pr-10 text-sm transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 sm:h-12 sm:px-4 sm:text-base"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="h-10 w-full rounded-xl bg-blue-600 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 disabled:bg-blue-400 active:scale-[0.98] sm:h-12 sm:text-base"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <div className="mt-4 text-center sm:mt-6">
            <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
              По умолчанию: <span className="rounded bg-gray-100 px-2 py-0.5 font-mono dark:bg-gray-700">admin / admin123</span>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-blue-100 sm:text-sm">© 2024 Sellary POS</p>
      </div>
    </div>
  );
}
