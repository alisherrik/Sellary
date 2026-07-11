import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { getErrorMessage } from '../lib/error';

export function PinSetupPage() {
  const navigate = useNavigate();
  const { completePinSetup, isBootstrapping } = useAuthStore();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pin.length < 4) {
      setError('PIN должен содержать минимум 4 цифры');
      return;
    }
    if (pin !== confirm) {
      setError('PIN-коды не совпадают');
      return;
    }
    try {
      await completePinSetup(pin);
      navigate('/cashier', { replace: true });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Не удалось сохранить PIN'));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow dark:bg-gray-800">
        <h1 className="mb-1 text-center text-xl font-bold dark:text-white">Задайте PIN</h1>
        <p className="mb-4 text-center text-sm text-gray-500">
          PIN нужен для входа без интернета.
        </p>
        {error && (
          <div className="mb-3 rounded bg-red-50 p-2 text-center text-sm text-red-600">{error}</div>
        )}
        <label className="mb-1 block text-sm font-medium dark:text-gray-200">Новый PIN</label>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mb-3 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
          autoFocus
        />
        <label className="mb-1 block text-sm font-medium dark:text-gray-200">Повторите PIN</label>
        <input
          type="password"
          inputMode="numeric"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
        />
        <button
          type="submit"
          disabled={isBootstrapping}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isBootstrapping ? 'Загрузка каталога...' : 'Сохранить PIN'}
        </button>
      </form>
    </div>
  );
}
