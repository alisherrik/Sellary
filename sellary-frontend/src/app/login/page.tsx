'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import toast from 'react-hot-toast';
import { ShoppingBagIcon, EyeIcon, EyeSlashIcon, ServerIcon } from '@heroicons/react/24/outline';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login, token } = useAuthStore();
  const { isServerReachable, isChecking } = useServerHealth();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NON-NEGOTIABLE: Login is STRICTLY DISALLOWED while server offline
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // - If server offline + no token → Show "Server Unavailable"
  // - If server offline + has token → Redirect to app (offline mode)
  // - If server online → Show login form
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // If already authenticated, redirect to app
  useEffect(() => {
    if (token) {
      router.push('/pos');
    }
  }, [token, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CRITICAL: Do not allow login submission if server is offline
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!isServerReachable) {
      toast.error('Сервер недоступен. Невозможно выполнить вход.');
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LOADING STATE: Health check in progress
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 px-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl mb-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div>
          </div>
          <p className="text-white text-lg font-medium">Подключение к серверу...</p>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SERVER UNAVAILABLE STATE: Login BLOCKED
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!isServerReachable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-600 via-gray-700 to-gray-800 px-4 py-8">
        <div className="w-full max-w-sm text-center">
          {/* Warning Icon */}
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-500/20 backdrop-blur-sm rounded-full mb-6">
            <ServerIcon className="w-10 h-10 text-red-400" />
          </div>

          {/* Error Message */}
          <h1 className="text-3xl font-black text-white mb-3">Сервер недоступен</h1>
          <p className="text-gray-300 text-base mb-8">
            Невозможно подключиться к серверу. Проверьте подключение к сети или попробуйте позже.
          </p>

          {/* Retry Button */}
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-gray-800 rounded-xl font-bold hover:bg-gray-100 transition-all shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Попробовать снова
          </button>

          {/* Footer */}
          <p className="text-gray-400 text-sm mt-8">
            © 2024 Sellary POS
          </p>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ONLINE STATE: Show login form
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-white/20 backdrop-blur-sm rounded-2xl mb-4">
            <ShoppingBagIcon className="w-10 h-10 sm:w-12 sm:h-12 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Sellary</h1>
          <p className="text-blue-100 text-sm sm:text-base mt-1">Система управления продажами</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 sm:p-8">
          <div className="flex items-center justify-center mb-5 sm:mb-6">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white text-center">
              Войти в аккаунт
            </h2>
            <div className="w-2 h-2 bg-green-500 rounded-full ml-2 animate-pulse"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Имя пользователя
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-10 sm:h-12 px-3 sm:px-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm sm:text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="admin"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                  className="w-full h-10 sm:h-12 px-3 sm:px-4 pr-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm sm:text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl font-bold text-sm sm:text-base shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98]"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <div className="mt-4 sm:mt-6 text-center">
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              По умолчанию: <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">admin / admin123</span>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs sm:text-sm text-blue-100 mt-6">
          © 2024 Sellary POS
        </p>
      </div>
    </div>
  );
}
