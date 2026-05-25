'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  BuildingOffice2Icon,
  EyeIcon,
  EyeSlashIcon,
  ServerIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

import { isOfflineModeEnabled } from '@/lib/features';
import { useAuthStore } from '@/lib/store';
import type { CompanySummary } from '@/lib/types';
import { useServerHealth } from '@/providers/ServerHealthProvider';

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

  const isChoosingCompany = useMemo(
    () => !accessToken && !!loginToken && pendingCompanies.length > 0,
    [accessToken, loginToken, pendingCompanies.length],
  );

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (accessToken && currentCompany) {
      router.replace('/pos');
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
      toast.error('Server is unavailable. Login is blocked until the API comes back online.');
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
        toast.success('Choose the company you want to work in.');
      } else {
        toast.success('Login successful.');
        router.replace('/pos');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompanySelection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCompanyId) {
      toast.error('Choose a company first.');
      return;
    }

    setSelectingCompany(true);
    try {
      await selectCompany(selectedCompanyId);
      toast.success('Company selected.');
      router.replace('/pos');
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Could not open that company.',
      );
    } finally {
      setSelectingCompany(false);
    }
  };

  if (!hasHydrated || isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="mt-4 text-sm text-slate-300">
            {!hasHydrated ? 'Restoring session...' : 'Checking backend connection...'}
          </p>
        </div>
      </div>
    );
  }

  if (!isServerReachable) {
    if (isOfflineModeEnabled && accessToken && currentCompany) {
      router.replace('/pos');
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
            <p className="mt-4 text-sm text-slate-300">Entering offline mode...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-3xl border border-red-500/20 bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <ServerIcon className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-slate-900">Server Unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Login is disabled until the backend becomes reachable again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Retry connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh min-h-screen bg-[radial-gradient(circle_at_top,_#dbeafe,_transparent_35%),linear-gradient(135deg,_#0f172a,_#1e293b_45%,_#111827)] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[32px] border border-white/10 bg-white shadow-2xl lg:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                <ShoppingBagIcon className="h-8 w-8" />
              </div>
              <h1 className="mt-8 text-4xl font-black tracking-tight">Sellary</h1>
              <p className="mt-4 max-w-sm text-sm leading-7 text-slate-300">
                Company-aware POS access with clean session boundaries and fast switching.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Session rules</p>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                One login can access multiple companies. After sign-in, choose the company you
                want to work in and Sellary will scope the whole session to that tenant.
              </p>
              {isOfflineModeEnabled && (
                <p className="mt-4 text-xs leading-5 text-amber-300">
                  Offline mode is enabled. Multi-company sessions stay blocked until
                  `NEXT_PUBLIC_ENABLE_OFFLINE_MODE=false`.
                </p>
              )}
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mb-8 lg:hidden">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <ShoppingBagIcon className="h-7 w-7" />
              </div>
              <h1 className="mt-4 text-3xl font-black text-slate-900">Sellary</h1>
            </div>

            {!isChoosingCompany ? (
              <>
                <div className="mb-8">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">
                    Step 1
                  </p>
                  <h2 className="mt-2 text-3xl font-bold text-slate-900">Sign in</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Enter your credentials to load the companies attached to your account.
                  </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-5">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Username</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-sky-500 focus:bg-white"
                      placeholder="admin"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
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
                    {submitting ? 'Loading companies...' : 'Continue'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="mb-8">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">
                    Step 2
                  </p>
                  <h2 className="mt-2 text-3xl font-bold text-slate-900">Choose Company</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Your identity is loaded. Pick the company that should scope this session.
                  </p>
                </div>

                <form onSubmit={handleCompanySelection} className="space-y-4">
                  {pendingCompanies.map((company) => {
                    const checked = selectedCompanyId === company.id;
                    return (
                      <label
                        key={company.id}
                        className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition ${
                          checked
                            ? 'border-sky-500 bg-sky-50 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="company"
                          value={company.id}
                          checked={checked}
                          onChange={() => setSelectedCompanyId(company.id)}
                          className="mt-1 h-4 w-4"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <BuildingOffice2Icon className="h-5 w-5 text-slate-500" />
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {company.name}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{company.slug}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                            {company.role}
                            {company.is_default ? ' • default' : ''}
                          </p>
                        </div>
                      </label>
                    );
                  })}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingCompanies([]);
                        setSelectedCompanyId(null);
                      }}
                      className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={selectingCompany || selectedCompanyId === null}
                      className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {selectingCompany ? 'Opening company...' : 'Open workspace'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
