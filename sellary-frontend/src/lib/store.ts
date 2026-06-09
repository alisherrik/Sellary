'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { authApi } from './api';
import {
  AUTH_STORAGE_KEY,
  CART_STORAGE_KEY,
  clearStoredSession,
  createCompanyScopedJSONStorage,
  getActiveAccessToken,
  setAccessTokenForCompany,
  setCurrentCompanyId,
  setLoginToken,
} from './session';
import type { CartItem, CompanySession, CompanySummary, Product, User } from './types';

interface LoginResult {
  requiresCompanySelection: boolean;
  companies: CompanySummary[];
  currentCompany?: CompanySummary;
}

interface AuthState {
  user: User | null;
  companies: CompanySummary[];
  currentCompany: CompanySummary | null;
  loginToken: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  selectCompany: (companyId: number) => Promise<CompanySummary>;
  switchCompany: (companyId: number) => Promise<CompanySummary>;
  acceptCompanySession: (session: CompanySession) => CompanySummary;
  logout: () => void;
  fetchSession: () => Promise<void>;
}

const emptyAuthState = {
  user: null,
  companies: [],
  currentCompany: null,
  loginToken: null,
  accessToken: null,
  isAuthenticated: false,
  hasHydrated: false,
};

const applyCompanySession = (
  set: (partial: Partial<AuthState>) => void,
  session: CompanySession,
): CompanySummary => {
  setCurrentCompanyId(session.current_company.id);
  setLoginToken(null);
  setAccessTokenForCompany(session.current_company.id, session.access_token);

  set({
    user: session.user,
    companies: session.companies,
    currentCompany: session.current_company,
    loginToken: null,
    accessToken: session.access_token,
    isAuthenticated: true,
    hasHydrated: true,
  });

  return session.current_company;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...emptyAuthState,

      login: async (username, password) => {
        const response = await authApi.login(username, password);
        const session = response.data;

        setLoginToken(session.login_token);
        set({
          user: session.user,
          companies: session.companies,
          currentCompany: null,
          loginToken: session.login_token,
          accessToken: null,
          isAuthenticated: false,
          hasHydrated: true,
        });

        if (session.companies.length === 1) {
          const currentCompany = await get().selectCompany(session.companies[0].id);
          return {
            requiresCompanySelection: false,
            companies: session.companies,
            currentCompany,
          };
        }

        return {
          requiresCompanySelection: true,
          companies: session.companies,
        };
      },

      selectCompany: async (companyId) => {
        const loginToken = get().loginToken;
        if (!loginToken) {
          throw new Error('Login session expired. Please sign in again.');
        }

        const response = await authApi.selectCompany(companyId, loginToken);
        return applyCompanySession(set, response.data);
      },

      switchCompany: async (companyId) => {
        const response = await authApi.switchCompany(companyId);
        return applyCompanySession(set, response.data);
      },

      acceptCompanySession: (session) => applyCompanySession(set, session),

      logout: () => {
        clearStoredSession(get().companies.map((company) => company.id));
        set({ ...emptyAuthState, hasHydrated: true });
      },

      fetchSession: async () => {
        const activeToken = get().accessToken ?? getActiveAccessToken();
        if (!activeToken) {
          return;
        }

        const response = await authApi.me();
        const session = response.data;

        setCurrentCompanyId(session.current_company.id);
        setAccessTokenForCompany(session.current_company.id, activeToken);
        set({
          user: session.user,
          companies: session.companies,
          currentCompany: session.current_company,
          accessToken: activeToken,
          isAuthenticated: true,
          hasHydrated: true,
        });
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        companies: state.companies,
        currentCompany: state.currentCompany,
        loginToken: state.loginToken,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const activeToken = getActiveAccessToken();
        if (activeToken && state.currentCompany) {
          state.accessToken = activeToken;
          state.isAuthenticated = true;
        }

        state.hasHydrated = true;

        if (!activeToken || !state.currentCompany) {
          return;
        }
      },
    },
  ),
);

interface Session {
  id: string;
  name: string;
  items: CartItem[];
  createdAt: number;
}

interface CartState {
  sessions: Session[];
  activeSessionId: string;
  createSession: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  setDiscount: (productId: number, discount: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
  resetState: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

const createDefaultCartState = () => ({
  sessions: [{ id: 'default', name: 'Продажа 1', items: [], createdAt: Date.now() }],
  activeSessionId: 'default',
});

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      ...createDefaultCartState(),

      resetState: () => set(createDefaultCartState()),

      createSession: () =>
        set((state) => {
          const newId = generateId();
          return {
            sessions: [
              ...state.sessions,
              {
                id: newId,
                name: `Продажа ${state.sessions.length + 1}`,
                items: [],
                createdAt: Date.now(),
              },
            ],
            activeSessionId: newId,
          };
        }),

      switchSession: (sessionId) => set({ activeSessionId: sessionId }),

      deleteSession: (sessionId) =>
        set((state) => {
          if (state.sessions.length <= 1) {
            return state;
          }

          const newSessions = state.sessions.filter((session) => session.id !== sessionId);
          return {
            sessions: newSessions,
            activeSessionId:
              state.activeSessionId === sessionId ? newSessions[0].id : state.activeSessionId,
          };
        }),

      renameSession: (sessionId, name) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, name } : session,
          ),
        })),

      addItem: (product, quantity = 1) =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const session = state.sessions[sessionIndex];
          const existingItem = session.items.find((item) => item.product.id === product.id);

          const newItems = existingItem
            ? session.items.map((item) =>
                item.product.id === product.id
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              )
            : [...session.items, { product, quantity, discount: 0 }];

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        }),

      removeItem: (productId) =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const session = state.sessions[sessionIndex];
          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = {
            ...session,
            items: session.items.filter((item) => item.product.id !== productId),
          };
          return { sessions: newSessions };
        }),

      updateQuantity: (productId, quantity) =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const session = state.sessions[sessionIndex];
          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = {
            ...session,
            items: session.items.map((item) =>
              item.product.id === productId ? { ...item, quantity } : item,
            ),
          };
          return { sessions: newSessions };
        }),

      setDiscount: (productId, discount) =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const session = state.sessions[sessionIndex];
          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = {
            ...session,
            items: session.items.map((item) =>
              item.product.id === productId ? { ...item, discount } : item,
            ),
          };
          return { sessions: newSessions };
        }),

      clearCart: () =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...newSessions[sessionIndex], items: [] };
          return { sessions: newSessions };
        }),

      getSubtotal: () => {
        const items =
          get().sessions.find((session) => session.id === get().activeSessionId)?.items || [];
        return items.reduce(
          (sum, item) => sum + Number(item.product.sell_price) * item.quantity,
          0,
        );
      },

      getTax: () => {
        const items =
          get().sessions.find((session) => session.id === get().activeSessionId)?.items || [];
        return items.reduce((sum, item) => {
          const subtotal = Number(item.product.sell_price) * item.quantity;
          return sum + subtotal * (Number(item.product.tax_percent) / 100);
        }, 0);
      },

      getTotal: () => get().getSubtotal() + get().getTax(),

      getItemCount: () => {
        const items =
          get().sessions.find((session) => session.id === get().activeSessionId)?.items || [];
        return items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createCompanyScopedJSONStorage(),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme:
    (typeof window !== 'undefined'
      ? (localStorage.getItem('theme') as 'light' | 'dark')
      : 'light') || 'light',

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleTheme: () => {
    set((state) => {
      const theme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', theme);
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }
      return { theme };
    });
  },

  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    set({ theme });
  },
}));

if (typeof window !== 'undefined') {
  useAuthStore.subscribe((state, previousState) => {
    const companyId = state.currentCompany?.id ?? null;
    const previousCompanyId = previousState.currentCompany?.id ?? null;

    if (companyId === previousCompanyId) {
      return;
    }

    useCartStore.getState().resetState();
    void useCartStore.persist.rehydrate();
  });
}
