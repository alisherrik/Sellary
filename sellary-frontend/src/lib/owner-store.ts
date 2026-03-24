'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ownerApi } from './api';
import {
  OWNER_AUTH_STORAGE_KEY,
  clearOwnerSession,
  getOwnerAccessToken,
  setOwnerAccessToken,
} from './owner-session';
import type { User } from './types';

interface OwnerAuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  fetchSession: () => Promise<void>;
}

const emptyOwnerState = {
  user: null,
  accessToken: null,
  isAuthenticated: false,
  hasHydrated: false,
};

export const useOwnerStore = create<OwnerAuthState>()(
  persist(
    (set, get) => ({
      ...emptyOwnerState,

      login: async (username, password) => {
        const response = await ownerApi.login(username, password);
        setOwnerAccessToken(response.data.access_token);
        set({
          user: response.data.user,
          accessToken: response.data.access_token,
          isAuthenticated: true,
          hasHydrated: true,
        });
      },

      logout: () => {
        clearOwnerSession();
        set({ ...emptyOwnerState, hasHydrated: true });
      },

      fetchSession: async () => {
        const activeToken = get().accessToken ?? getOwnerAccessToken();
        if (!activeToken) {
          return;
        }

        const response = await ownerApi.session();
        setOwnerAccessToken(activeToken);
        set({
          user: response.data.user,
          accessToken: activeToken,
          isAuthenticated: true,
          hasHydrated: true,
        });
      },
    }),
    {
      name: OWNER_AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const activeToken = getOwnerAccessToken();
        if (activeToken) {
          state.accessToken = activeToken;
          state.isAuthenticated = true;
        }

        state.hasHydrated = true;
      },
    },
  ),
);
