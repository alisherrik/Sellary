'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, CartItem, Product } from './types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (username, password) => {
        const { authApi } = await import('./api');
        const response = await authApi.login(username, password);
        const { access_token, user } = response.data;
        localStorage.setItem('token', access_token);
        set({ user, token: access_token, isAuthenticated: true });
      },

      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false });
      },

      fetchUser: async () => {
        const { authApi } = await import('./api');
        const response = await authApi.me();
        set({ user: response.data, isAuthenticated: true });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, token: state.token, isAuthenticated: state.isAuthenticated }),
    }
  )
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

  // Session Management
  createSession: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;

  // Cart Operations (Current Session)
  // items: CartItem[]; // Removed, derived in component
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  setDiscount: (productId: number, discount: number) => void;
  clearCart: () => void;

  // Calculations
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      sessions: [{ id: 'default', name: 'Продажа 1', items: [], createdAt: Date.now() }],
      activeSessionId: 'default',

      // Removed getter 'items' to avoid persist middleware conflict.
      // Logic moved to component selectors.

      createSession: () => set((state) => {
        const newId = generateId();
        return {
          sessions: [
            ...state.sessions,
            { id: newId, name: `Продажа ${state.sessions.length + 1}`, items: [], createdAt: Date.now() }
          ],
          activeSessionId: newId
        };
      }),

      switchSession: (sessionId) => set({ activeSessionId: sessionId }),

      deleteSession: (sessionId) => set((state) => {
        if (state.sessions.length <= 1) return state; // Don't delete last session
        const newSessions = state.sessions.filter(s => s.id !== sessionId);
        return {
          sessions: newSessions,
          activeSessionId: state.activeSessionId === sessionId ? newSessions[0].id : state.activeSessionId
        };
      }),

      renameSession: (sessionId, name) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, name } : s)
      })),

      addItem: (product, quantity = 1) => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
          if (sessionIndex === -1) return state;

          const session = state.sessions[sessionIndex];
          const existingItem = session.items.find((item) => item.product.id === product.id);

          let newItems;
          if (existingItem) {
            newItems = session.items.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: item.quantity + quantity }
                : item
            );
          } else {
            newItems = [...session.items, { product, quantity, discount: 0 }];
          }

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        });
      },

      removeItem: (productId) => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
          if (sessionIndex === -1) return state;

          const session = state.sessions[sessionIndex];
          const newItems = session.items.filter((item) => item.product.id !== productId);

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        });
      },

      updateQuantity: (productId, quantity) => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
          if (sessionIndex === -1) return state;

          const session = state.sessions[sessionIndex];
          const newItems = session.items.map((item) =>
            item.product.id === productId ? { ...item, quantity } : item
          );

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        });
      },

      setDiscount: (productId, discount) => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
          if (sessionIndex === -1) return state;

          const session = state.sessions[sessionIndex];
          const newItems = session.items.map((item) =>
            item.product.id === productId ? { ...item, discount } : item
          );

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...session, items: newItems };
          return { sessions: newSessions };
        });
      },

      clearCart: () => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
          if (sessionIndex === -1) return state;

          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = { ...newSessions[sessionIndex], items: [] };
          return { sessions: newSessions };
        });
      },

      getSubtotal: () => {
        const state = get();
        const items = state.sessions.find(s => s.id === state.activeSessionId)?.items || [];
        return items.reduce((sum, item) => {
          return sum + Number(item.product.sell_price) * item.quantity;
        }, 0);
      },

      getTax: () => {
        const state = get();
        const items = state.sessions.find(s => s.id === state.activeSessionId)?.items || [];
        return items.reduce((sum, item) => {
          const itemSubtotal = Number(item.product.sell_price) * item.quantity;
          const tax = itemSubtotal * (Number(item.product.tax_percent) / 100);
          return sum + tax;
        }, 0);
      },

      getTotal: () => {
        return get().getSubtotal() + get().getTax();
      },

      getItemCount: () => {
        const state = get();
        const items = state.sessions.find(s => s.id === state.activeSessionId)?.items || [];
        return items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: 'cart-storage-v2', // Updated key to avoid conflict
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId
      }),
    }
  )
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
  theme: (typeof window !== 'undefined' ? (localStorage.getItem('theme') as 'light' | 'dark') : 'light') || 'light',

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', newTheme === 'dark');
      }
      return { theme: newTheme };
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
