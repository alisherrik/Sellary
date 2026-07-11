import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';

export function NeedsReauthBanner() {
  const navigate = useNavigate();
  const needsReauth = useAuthStore((s) => s.needsReauth);
  if (!needsReauth) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-800">
      <span>Требуется вход через интернет. Продажи сохраняются локально.</span>
      <button
        type="button"
        onClick={() => navigate('/login')}
        className="rounded bg-amber-600 px-3 py-1 font-medium text-white"
      >
        Войти через интернет
      </button>
    </div>
  );
}
