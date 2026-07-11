import { create } from 'zustand';
import {
  login,
  selectCompany,
  setAccessToken as setApiToken,
  fetchBootstrap,
} from './api';
import type { LoginTokenResponse } from './api';
import {
  upsertProducts,
  upsertCategories,
  setMeta,
  addSyncEvent,
  getDeviceAuth,
  recordPinFailure,
  resetPinFailures,
} from './db';
import { setStoreValue } from './storage';
import { getErrorMessage } from './error';
import {
  saveCashierSession,
  loadCashierSession,
  clearCashierSession,
  getTokenExpiresAt,
  loadDeviceCredential,
  verifyPin,
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

  // Temporary stubs to satisfy the AuthState interface added in Task 5.
  // Real implementations land in Task 7 (ensureFreshAccessToken) and
  // Task 8 (completePinSetup).
  completePinSetup: async () => {
    throw new Error('completePinSetup is not implemented yet (see Task 8)');
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
  ensureFreshAccessToken: async () => {},

  loginUser: async (username, password) => {
    return login(username, password);
  },

  selectAndBootstrap: async (loginToken, companyId) => {
    set({ isBootstrapping: true });
    let phase = 'select company';

    try {
      phase = 'select company';
      const tokenRes = await selectCompany(loginToken, companyId);
      setApiToken(tokenRes.access_token);

      phase = 'download bootstrap catalog';
      const bootstrap = await fetchBootstrap();

      phase = 'save categories';
      await upsertCategories(bootstrap.categories);

      phase = 'save products';
      await upsertProducts(bootstrap.products);

      phase = 'save sync metadata';
      await setMeta('last_bootstrap_time', bootstrap.server_time);
      await setMeta('last_company_id', String(bootstrap.company_id));

      phase = 'save selected company';
      await setStoreValue('last_company_id', bootstrap.company_id);

      set({
        isAuthenticated: true,
        isBootstrapping: false,
        companyId: bootstrap.company_id,
        companyName: bootstrap.company_name,
        userId: bootstrap.user_id,
        username: bootstrap.user_username,
        userRole: bootstrap.user_role,
      });

      await saveCashierSession({
        accessToken: tokenRes.access_token,
        expiresAt: getTokenExpiresAt(tokenRes.access_token),
        companyId: bootstrap.company_id,
        companyName: bootstrap.company_name,
        userId: bootstrap.user_id,
        username: bootstrap.user_username,
        userRole: bootstrap.user_role,
      });

      await addSyncEvent('bootstrap', 'success').catch((error) => {
        console.warn('Failed to write bootstrap success event', error);
      });
    } catch (e: unknown) {
      set({ isBootstrapping: false });
      const msg = `${phase}: ${getErrorMessage(e, 'Bootstrap failed')}`;
      console.error('Company bootstrap failed', { phase, error: e });
      await addSyncEvent('bootstrap', 'error', msg).catch((error) => {
        console.warn('Failed to write bootstrap error event', error);
      });
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
    setApiToken(null);
    await clearCashierSession().catch((error) => {
      console.warn('Failed to clear session', error);
    });
    set({
      isAuthenticated: false,
      companyId: null,
      companyName: null,
      userId: null,
      username: null,
      userRole: null,
    });
  },
}));
