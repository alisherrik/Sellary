import { create } from 'zustand';
import {
  login,
  selectCompany,
  setAccessToken as setApiToken,
  getAccessToken,
  fetchBootstrap,
  registerDevice,
  refreshDevice,
  ApiError,
} from './api';
import type { LoginTokenResponse } from './api';
import {
  upsertProducts,
  upsertCategories,
  setMeta,
  addSyncEvent,
  getDeviceAuth,
  ensureDeviceAuth,
  bindDeviceIdentity,
  recordPinFailure,
  resetPinFailures,
  getUnsyncedCount,
} from './db';
import { setStoreValue } from './storage';
import { getErrorMessage } from './error';
import {
  saveCashierSession,
  loadCashierSession,
  clearCashierSession,
  getTokenExpiresAt,
  loadDeviceCredential,
  saveDeviceCredential,
  clearDeviceCredential,
  savePin,
  verifyPin,
  clearPin,
} from './session';

interface AuthState {
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  companyId: number | null;
  companyName: string | null;
  userId: number | null;
  username: string | null;
  userRole: string | null;

  hasDevice: boolean;
  hasPin: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  needsReauth: boolean;

  completePinSetup: (pin: string) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  ensureFreshAccessToken: () => Promise<void>;

  loginUser: (username: string, password: string) => Promise<LoginTokenResponse>;
  selectAndBootstrap: (loginToken: string, companyId: number) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  restoreSession: () => Promise<boolean>;
  logout: () => Promise<void>;
}

const MAX_PIN_ATTEMPTS = 5;
const LOCK_BASE_SECONDS = 30;
const LOCK_CAP_SECONDS = 15 * 60;

function computeLockUntil(attempts: number): string | null {
  if (attempts < MAX_PIN_ATTEMPTS) {
    return null;
  }
  const over = attempts - MAX_PIN_ATTEMPTS;
  const seconds = Math.min(LOCK_CAP_SECONDS, LOCK_BASE_SECONDS * 2 ** over);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

const REFRESH_WINDOW_MS = 12 * 60 * 60 * 1000; // refresh within 12h of expiry

let refreshInFlight: Promise<void> | null = null;

function needsTokenRefresh(expiresAt: string | undefined | null): boolean {
  if (!expiresAt) return true;
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) return true;
  return exp - Date.now() <= REFRESH_WINDOW_MS;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isBootstrapping: false,
  companyId: null,
  companyName: null,
  userId: null,
  username: null,
  userRole: null,

  hasDevice: false,
  hasPin: false,
  isLocked: false,
  lockedUntil: null,
  needsReauth: false,

  completePinSetup: async (pin) => {
    set({ isBootstrapping: true });
    let phase = 'set pin';
    try {
      await savePin(pin);
      set({ hasPin: true });

      phase = 'download bootstrap catalog';
      const bootstrap = await fetchBootstrap();
      await upsertCategories(bootstrap.categories);
      await upsertProducts(bootstrap.products);
      await setMeta('last_bootstrap_time', bootstrap.server_time);
      await setMeta('last_company_id', String(bootstrap.company_id));
      await setStoreValue('last_company_id', bootstrap.company_id);

      const accessToken = getAccessToken();
      if (accessToken) {
        await saveCashierSession({
          accessToken,
          expiresAt: getTokenExpiresAt(accessToken),
          companyId: bootstrap.company_id,
          companyName: bootstrap.company_name,
          userId: bootstrap.user_id,
          username: bootstrap.user_username,
          userRole: bootstrap.user_role,
        });
      }

      set({
        isAuthenticated: true,
        isBootstrapping: false,
        companyId: bootstrap.company_id,
        companyName: bootstrap.company_name,
        userId: bootstrap.user_id,
        username: bootstrap.user_username,
        userRole: bootstrap.user_role,
      });
      await addSyncEvent('bootstrap', 'success').catch(() => {});
    } catch (e: unknown) {
      set({ isBootstrapping: false });
      const msg = `${phase}: ${getErrorMessage(e, 'Bootstrap failed')}`;
      console.error('PIN setup / bootstrap failed', { phase, error: e });
      await addSyncEvent('bootstrap', 'error', msg).catch(() => {});
      throw new Error(msg);
    }
  },
  unlockWithPin: async (pin) => {
    const auth = await getDeviceAuth();
    if (!auth) {
      return false;
    }
    if (auth.locked_until && Date.parse(auth.locked_until) > Date.now()) {
      set({ isLocked: true, lockedUntil: auth.locked_until });
      return false;
    }

    const ok = await verifyPin(pin);
    if (!ok) {
      const attempts = (auth.failed_pin_attempts ?? 0) + 1;
      const lockUntil = computeLockUntil(attempts);
      await recordPinFailure(lockUntil);
      set({ isLocked: !!lockUntil, lockedUntil: lockUntil });
      return false;
    }

    await resetPinFailures();
    set({
      isAuthenticated: true,
      isLocked: false,
      lockedUntil: null,
      needsReauth: false,
      companyId: auth.company_id,
      companyName: auth.company_name,
      userId: auth.user_id,
      username: auth.username,
      userRole: auth.user_role,
    });
    // Non-blocking: try to freshen the sync credential if online / near-expiry.
    void get().ensureFreshAccessToken();
    return true;
  },
  ensureFreshAccessToken: async () => {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      try {
        const cred = await loadDeviceCredential();
        if (!cred) {
          return;
        }
        const session = await loadCashierSession();
        if (!needsTokenRefresh(session?.expiresAt)) {
          return;
        }
        const auth = await getDeviceAuth();
        if (!auth?.device_id) {
          return;
        }
        const res = await refreshDevice(auth.device_id, cred.deviceToken);
        setApiToken(res.access_token);
        await saveCashierSession({
          accessToken: res.access_token,
          expiresAt: getTokenExpiresAt(res.access_token),
          companyId: auth.company_id ?? 0,
          companyName: auth.company_name ?? '',
          userId: auth.user_id ?? 0,
          username: auth.username ?? '',
          userRole: auth.user_role ?? '',
        });
        await saveDeviceCredential(cred.deviceToken, res.expires_at);
        set({ needsReauth: false });
      } catch (e: unknown) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          set({ needsReauth: true });
        }
        // network / other errors: stay offline silently, app keeps working
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  loginUser: async (username, password) => {
    return login(username, password);
  },

  selectAndBootstrap: async (loginToken, companyId) => {
    set({ isBootstrapping: true });
    let phase = 'select company';
    try {
      const tokenRes = await selectCompany(loginToken, companyId);
      setApiToken(tokenRes.access_token);

      phase = 'register device';
      const existing = await getDeviceAuth();
      const deviceId = existing?.device_id ?? crypto.randomUUID();
      const reg = await registerDevice('Kassa', deviceId);
      await saveDeviceCredential(reg.device_token, reg.expires_at);
      await ensureDeviceAuth(reg.device_id);
      // Contract §4.6: snake_case DeviceIdentityInput, exactly 7 fields.
      // device_token_expires_at mirrors the register response; last_online_auth_at
      // is "now" because we just authenticated online.
      await bindDeviceIdentity({
        user_id: tokenRes.user.id,
        username: tokenRes.user.username,
        company_id: tokenRes.current_company.id,
        company_name: tokenRes.current_company.name,
        user_role: tokenRes.current_company.role,
        device_token_expires_at: reg.expires_at,
        last_online_auth_at: new Date().toISOString(),
      });

      set({
        isBootstrapping: false,
        hasDevice: true,
        hasPin: false,
        companyId: tokenRes.current_company.id,
        companyName: tokenRes.current_company.name,
        userId: tokenRes.user.id,
        username: tokenRes.user.username,
        userRole: tokenRes.current_company.role,
      });

      await addSyncEvent('device_register', 'success').catch(() => {});
    } catch (e: unknown) {
      set({ isBootstrapping: false });
      const msg = `${phase}: ${getErrorMessage(e, 'Provisioning failed')}`;
      console.error('Device provisioning failed', { phase, error: e });
      await addSyncEvent('device_register', 'error', msg).catch(() => {});
      throw new Error(msg);
    }
  },

  refreshCatalog: async () => {
    const bootstrap = await fetchBootstrap();
    await upsertCategories(bootstrap.categories);
    await upsertProducts(bootstrap.products);
    await setMeta('last_bootstrap_time', bootstrap.server_time);
    await addSyncEvent('bootstrap', 'success', 'manual refresh').catch(console.warn);
  },

  restoreSession: async () => {
    try {
      const auth = await getDeviceAuth();
      const cred = await loadDeviceCredential();
      const hasDevice = !!(auth && auth.device_id && cred);
      const hasPin = !!(auth && auth.pin_hash);
      set({ hasDevice, hasPin });

      if (!hasDevice || !hasPin || !auth) {
        return false;
      }

      // Load whatever identity/token cache we have; the token MAY be expired —
      // we still open the app (PIN unlock gates entry). Never clear on expiry.
      const session = await loadCashierSession();
      if (session) {
        setApiToken(session.accessToken);
        set({
          companyId: session.companyId,
          companyName: session.companyName,
          userId: session.userId,
          username: session.username,
          userRole: session.userRole,
        });
      } else {
        set({
          companyId: auth.company_id,
          companyName: auth.company_name,
          userId: auth.user_id,
          username: auth.username,
          userRole: auth.user_role,
        });
      }

      const locked = !!(auth.locked_until && Date.parse(auth.locked_until) > Date.now());
      set({ isLocked: locked, lockedUntil: locked ? auth.locked_until : null });
      return true;
    } catch (error) {
      console.error('Failed to restore session', error);
      return false;
    }
  },

  logout: async () => {
    const unsynced = await getUnsyncedCount().catch(() => 0);
    if (unsynced > 0) {
      throw new Error(
        `Есть ${unsynced} неотправленных продаж. Дождитесь синхронизации.`
      );
    }
    setApiToken(null);
    await clearCashierSession().catch((error) => {
      console.warn('Failed to clear session', error);
    });
    await clearDeviceCredential().catch(() => {});
    await clearPin().catch(() => {});
    set({
      isAuthenticated: false,
      hasDevice: false,
      hasPin: false,
      isLocked: false,
      lockedUntil: null,
      needsReauth: false,
      companyId: null,
      companyName: null,
      userId: null,
      username: null,
      userRole: null,
    });
  },
}));
