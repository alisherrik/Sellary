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
import type { ModuleMap } from './modules';
import type { CartItem, CartUnit, CompanySession, CompanySummary, Product, User } from './types';

interface LoginResult {
  requiresCompanySelection: boolean;
  companies: CompanySummary[];
  currentCompany?: CompanySummary;
}

interface AuthState {
  user: User | null;
  companies: CompanySummary[];
  currentCompany: CompanySummary | null;
  modules: ModuleMap;
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
  modules: {} as ModuleMap,
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
    modules: session.modules ?? {},
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
          modules: {},
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
          throw new Error('Сессия входа истекла. Войдите снова.');
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
          modules: session.modules ?? {},
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
        modules: state.modules,
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

export const useModules = () => useAuthStore((state) => state.modules);

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
  // unit defaults to the product's base unit when omitted.
  addItem: (product: Product, unit?: CartUnit, quantity?: number) => void;
  // Lines are addressed by their composite key (see lineKey), so the same
  // product in different units are separate, independently-editable lines.
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  changeUnit: (key: string, unit: CartUnit) => void;
  setDiscount: (key: string, discount: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
  resetState: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

// Composite identity for a cart line: product + chosen unit (null = base unit).
const lineKey = (productId: number, unitId: number | null) =>
  `${productId}:${unitId ?? 'base'}`;
const itemKey = (item: CartItem) => lineKey(item.product.id, item.unit?.id ?? null);
const resolveUnit = (product: Product, unit?: CartUnit): CartUnit =>
  unit ?? { id: null, label: product.uom, factor: 1, price: Number(product.sell_price) };
const lineSubtotal = (item: CartItem) =>
  Number(item.unit?.price ?? item.product.sell_price) * item.quantity;

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

      addItem: (product, unit, quantity = 1) =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const resolved = resolveUnit(product, unit);
          const key = lineKey(product.id, resolved.id);
          const session = state.sessions[sessionIndex];
          const existingItem = session.items.find((item) => itemKey(item) === key);

          const newItems = existingItem
            ? session.items.map((item) =>
                itemKey(item) === key
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              )
            : [...session.items, { product, unit: resolved, quantity, discount: 0 }];

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        }),

      removeItem: (key) =>
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
            items: session.items.filter((item) => itemKey(item) !== key),
          };
          return { sessions: newSessions };
        }),

      updateQuantity: (key, quantity) =>
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
              itemKey(item) === key ? { ...item, quantity } : item,
            ),
          };
          return { sessions: newSessions };
        }),

      changeUnit: (key, unit) =>
        set((state) => {
          const sessionIndex = state.sessions.findIndex(
            (session) => session.id === state.activeSessionId,
          );
          if (sessionIndex === -1) {
            return state;
          }

          const session = state.sessions[sessionIndex];
          const target = session.items.find((item) => itemKey(item) === key);
          if (!target) {
            return state;
          }

          const newKey = lineKey(target.product.id, unit.id);
          let newItems;
          const collision = session.items.find(
            (item) => item !== target && itemKey(item) === newKey,
          );
          if (collision) {
            // Switching onto an existing line: merge quantities, drop the source.
            newItems = session.items
              .filter((item) => item !== target)
              .map((item) =>
                item === collision
                  ? { ...item, quantity: item.quantity + target.quantity }
                  : item,
              );
          } else {
            // Discount is reset because it was relative to the previous unit's price.
            newItems = session.items.map((item) =>
              item === target ? { ...item, unit, discount: 0 } : item,
            );
          }

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        }),

      setDiscount: (key, discount) =>
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
              itemKey(item) === key ? { ...item, discount } : item,
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
        return items.reduce((sum, item) => sum + lineSubtotal(item), 0);
      },

      getTax: () => {
        const items =
          get().sessions.find((session) => session.id === get().activeSessionId)?.items || [];
        return items.reduce((sum, item) => {
          return sum + lineSubtotal(item) * (Number(item.product.tax_percent) / 100);
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
      // v1 introduced per-line units (CartItem.unit). Older persisted carts lack
      // it, so reset rather than risk lines without a unit.
      version: 1,
      migrate: () => createDefaultCartState(),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);

// Desktop cart panel resize bounds (px). Default matches the previous fixed width.
export const CART_PANEL_MIN_WIDTH = 320;
export const CART_PANEL_MAX_WIDTH = 640;
export const CART_PANEL_DEFAULT_WIDTH = 380;

const clampCartWidth = (width: number) =>
  Math.min(CART_PANEL_MAX_WIDTH, Math.max(CART_PANEL_MIN_WIDTH, width));

const readSidebarCollapsed = () =>
  typeof window !== 'undefined' && localStorage.getItem('sidebarCollapsed') === '1';

const readCartPanelWidth = () => {
  if (typeof window === 'undefined') return CART_PANEL_DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem('cartPanelWidth'));
  return Number.isFinite(raw) && raw > 0 ? clampCartWidth(raw) : CART_PANEL_DEFAULT_WIDTH;
};

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  cartPanelWidth: number;
  theme: 'light' | 'dark';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCartPanelWidth: (width: number) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarCollapsed: readSidebarCollapsed(),
  cartPanelWidth: readCartPanelWidth(),
  theme:
    (typeof window !== 'undefined'
      ? (localStorage.getItem('theme') as 'light' | 'dark')
      : 'light') || 'light',

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleSidebarCollapsed: () =>
    set((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
      }
      return { sidebarCollapsed };
    }),
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    }
    set({ sidebarCollapsed: collapsed });
  },

  setCartPanelWidth: (width) => {
    const cartPanelWidth = clampCartWidth(width);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cartPanelWidth', String(cartPanelWidth));
    }
    set({ cartPanelWidth });
  },

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
