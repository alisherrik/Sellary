import { create } from 'zustand';
import {
  login,
  selectCompany,
  setAccessToken as setApiToken,
  fetchBootstrap,
} from './api';
import type { LoginTokenResponse } from './api';
import { upsertProducts, upsertCategories, setMeta, addSyncEvent } from './db';
import { setStoreValue } from './storage';
import { getErrorMessage } from './error';
import {
  saveCashierSession,
  loadCashierSession,
  clearCashierSession,
  isSessionExpired,
  getTokenExpiresAt,
} from './session';

interface AuthState {
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  companyId: number | null;
  companyName: string | null;
  userId: number | null;
  username: string | null;
  userRole: string | null;

  loginUser: (username: string, password: string) => Promise<LoginTokenResponse>;
  selectAndBootstrap: (loginToken: string, companyId: number) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  restoreSession: () => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isBootstrapping: false,
  companyId: null,
  companyName: null,
  userId: null,
  username: null,
  userRole: null,

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
      const session = await loadCashierSession();
      if (!session) {
        return false;
      }
      if (isSessionExpired(session)) {
        await clearCashierSession();
        return false;
      }
      setApiToken(session.accessToken);
      set({
        isAuthenticated: true,
        companyId: session.companyId,
        companyName: session.companyName,
        userId: session.userId,
        username: session.username,
        userRole: session.userRole,
      });
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
