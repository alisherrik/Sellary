import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { getApiBaseUrl, setApiBaseUrl, checkHealth } from '../lib/api';
import { useSyncStore } from '../lib/sync-store';

export function SettingsPage() {
  const navigate = useNavigate();
  const { username, companyName, userRole, logout, isAuthenticated, refreshCatalog } = useAuthStore();
  const unsyncedCount = useSyncStore((s) => s.unsyncedCount);
  const syncNow = useSyncStore((s) => s.syncNow);

  const [apiUrl, setApiUrlState] = useState('');
  const [urlLoaded, setUrlLoaded] = useState(false);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    getApiBaseUrl().then((url) => {
      setApiUrlState(url);
      setUrlLoaded(true);
    });
    checkHealth().then(setOnline);
  }, [isAuthenticated, navigate]);

  const handleSaveUrl = async () => {
    await setApiBaseUrl(apiUrl);
    const ok = await checkHealth();
    setOnline(ok);
    setMessage(ok ? 'Сохранено. Сервер доступен.' : 'Сохранено. Сервер недоступен.');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    try {
      await syncNow();
      setMessage('Синхронизация запущена.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshCatalog = async () => {
    setRefreshingCatalog(true);
    setMessage('');
    try {
      await refreshCatalog();
      setMessage('Каталог обновлен.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Ошибка обновления каталога');
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (!urlLoaded) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">Settings</h1>
          <button
            onClick={() => navigate('/cashier', { replace: true })}
            className="text-sm text-blue-600"
          >
            Back to POS
          </button>
        </div>

        {message && (
          <div className={`mb-3 p-2 rounded text-sm ${
            message.includes('доступен') ? 'bg-green-50 text-green-700' :
            message.includes('недоступен') ? 'bg-amber-50 text-amber-700' :
            'bg-blue-50 text-blue-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-white rounded-lg border p-4 mb-4">
          <h2 className="text-sm font-medium mb-2">Account</h2>
          <div className="text-sm space-y-1">
            <div><span className="text-gray-400">User:</span> {username}</div>
            <div><span className="text-gray-400">Role:</span> {userRole}</div>
            <div><span className="text-gray-400">Company:</span> {companyName}</div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 w-full py-1.5 rounded border border-red-200 text-red-600 text-sm hover:bg-red-50"
          >
            Logout
          </button>
        </div>

        <div className="bg-white rounded-lg border p-4 mb-4">
          <h2 className="text-sm font-medium mb-2">Server</h2>
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm">{online ? 'Online' : 'Offline'}</span>
          </div>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrlState(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm mb-2"
          />
          <button
            onClick={handleSaveUrl}
            className="w-full py-1.5 rounded bg-blue-600 text-white text-sm"
          >
            Save & Test
          </button>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-medium mb-2">Sync</h2>
          <p className="text-sm text-gray-400 mb-2">
            Не отправлено: {unsyncedCount}
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <button
            onClick={handleRefreshCatalog}
            disabled={refreshingCatalog}
            className="mt-2 w-full py-1.5 rounded border border-blue-200 text-blue-700 text-sm disabled:opacity-50"
          >
            {refreshingCatalog ? 'Refreshing' : 'Refresh Catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}
