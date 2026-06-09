import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { getApiBaseUrl, setApiBaseUrl } from '../lib/api';
import type { LoginTokenResponse } from '../lib/api';
import { getErrorMessage } from '../lib/error';

export function LoginPage() {
  const navigate = useNavigate();
  const { loginUser, selectAndBootstrap, isBootstrapping } = useAuthStore();

  const [apiUrl, setApiUrlState] = useState('');
  const [apiUrlLoaded, setApiUrlLoaded] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [companies, setCompanies] = useState<LoginTokenResponse['companies']>([]);

  if (!apiUrlLoaded) {
    getApiBaseUrl().then((url) => {
      setApiUrlState(url);
      setApiUrlLoaded(true);
    });
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await setApiBaseUrl(apiUrl);
      const result = await loginUser(username, password);
      setLoginToken(result.login_token);
      setCompanies(result.companies);
    } catch (err: unknown) {
      console.error('Login failed', err);
      setError(getErrorMessage(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCompanySelect = async (companyId: number) => {
    if (!loginToken) return;
    setError('');
    try {
      await selectAndBootstrap(loginToken, companyId);
      navigate('/cashier', { replace: true });
    } catch (err: unknown) {
      console.error('Company selection failed', err);
      setError(getErrorMessage(err, 'Company selection failed'));
    }
  };

  const handleLogoutFromCompanySelect = () => {
    setLoginToken(null);
    setCompanies([]);
  };

  if (companies.length > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow">
          <h1 className="mb-4 text-xl font-bold text-center">Select Company</h1>
          {error && (
            <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</div>
          )}
          <div className="space-y-2">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => handleCompanySelect(c.id)}
                disabled={isBootstrapping}
                className="w-full rounded border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-gray-400">{c.slug}</div>
              </button>
            ))}
          </div>
          <button
            onClick={handleLogoutFromCompanySelect}
            className="mt-4 w-full rounded bg-gray-200 px-4 py-2 text-sm font-medium"
          >
            Back
          </button>
          {isBootstrapping && (
            <div className="mt-3 text-center text-sm text-gray-500">
              Syncing catalog...
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow"
      >
        <h1 className="mb-6 text-xl font-bold text-center">Sellary Cashier</h1>

        {error && (
          <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</div>
        )}

        <label className="block text-sm font-medium mb-1">API URL</label>
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => setApiUrlState(e.target.value)}
          className="w-full rounded border px-3 py-2 mb-4 text-sm"
          placeholder="http://127.0.0.1:8001"
        />

        <label className="block text-sm font-medium mb-1">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded border px-3 py-2 mb-3 text-sm"
          required
        />

        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border px-3 py-2 mb-4 text-sm"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 px-4 py-2 text-white font-medium disabled:opacity-50"
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
