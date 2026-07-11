import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';

function remainingLabel(lockedUntil: string | null): string {
  if (!lockedUntil) return '';
  const ms = Date.parse(lockedUntil) - Date.now();
  if (ms <= 0) return '';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PinUnlockPage() {
  const navigate = useNavigate();
  const { unlockWithPin, isLocked, lockedUntil } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(remainingLabel(lockedUntil));

  useEffect(() => {
    if (!isLocked || !lockedUntil) return;
    const t = setInterval(() => setCountdown(remainingLabel(lockedUntil)), 1000);
    return () => clearInterval(t);
  }, [isLocked, lockedUntil]);

  const locked = isLocked && !!lockedUntil && Date.parse(lockedUntil) > Date.now();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const ok = await unlockWithPin(pin);
      if (ok) {
        navigate('/cashier', { replace: true });
      } else {
        setError('Неверный PIN');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow dark:bg-gray-800">
        <h1 className="mb-4 text-center text-xl font-bold dark:text-white">Введите PIN</h1>
        {locked && (
          <div className="mb-3 rounded bg-amber-50 p-3 text-center text-sm text-amber-700">
            Слишком много попыток. Попробуйте через {countdown}.
          </div>
        )}
        {error && !locked && (
          <div className="mb-3 rounded bg-red-50 p-2 text-center text-sm text-red-600">{error}</div>
        )}
        <label htmlFor="pin-input" className="mb-1 block text-sm font-medium dark:text-gray-200">PIN</label>
        <input
          id="pin-input"
          type="password"
          inputMode="numeric"
          value={pin}
          disabled={locked || busy}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
          autoFocus
        />
        <button
          type="submit"
          disabled={locked || busy || pin.length < 4}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Разблокировать
        </button>
        <button
          type="button"
          onClick={() => navigate('/login', { replace: true })}
          className="mt-4 w-full text-center text-sm text-blue-600 underline"
        >
          Забыли PIN? Войдите через интернет
        </button>
      </form>
    </div>
  );
}
