'use client';

import { createJSONStorage, type StateStorage } from 'zustand/middleware';

import { isOfflineModeEnabled } from './features';

export const AUTH_STORAGE_KEY = 'auth-storage-v2';
export const CART_STORAGE_KEY = 'cart-storage-v3';
export const RESTAURANT_STORAGE_KEY = 'restaurant-storage-v4';
export const QUERY_STORAGE_KEY = 'react-query-cache';
export const SYNC_QUEUE_STORAGE_KEY = 'offline-sync-queue';

const CURRENT_COMPANY_KEY = 'sellary:current-company-id';
const LOGIN_TOKEN_KEY = 'sellary:login-token';
const ACCESS_TOKEN_PREFIX = 'sellary:access-token';

const isBrowser = () => typeof window !== 'undefined';

export const getTenantStorageKey = (
  baseKey: string,
  companyId?: number | string | null,
): string => `${baseKey}:${companyId ?? 'guest'}`;

export const getCurrentCompanyId = (): number | null => {
  if (!isBrowser()) {
    return null;
  }

  const raw = window.localStorage.getItem(CURRENT_COMPANY_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const setCurrentCompanyId = (companyId: number | null): void => {
  if (!isBrowser()) {
    return;
  }

  if (companyId == null) {
    window.localStorage.removeItem(CURRENT_COMPANY_KEY);
    return;
  }

  window.localStorage.setItem(CURRENT_COMPANY_KEY, String(companyId));
};

export const getLoginToken = (): string | null => {
  if (!isBrowser()) {
    return null;
  }

  return window.localStorage.getItem(LOGIN_TOKEN_KEY);
};

export const setLoginToken = (token: string | null): void => {
  if (!isBrowser()) {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(LOGIN_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(LOGIN_TOKEN_KEY, token);
};

export const getAccessTokenForCompany = (
  companyId: number | string | null | undefined,
): string | null => {
  if (!isBrowser() || companyId == null) {
    return null;
  }

  return window.localStorage.getItem(getTenantStorageKey(ACCESS_TOKEN_PREFIX, companyId));
};

export const getActiveAccessToken = (): string | null =>
  getAccessTokenForCompany(getCurrentCompanyId());

export const setAccessTokenForCompany = (
  companyId: number,
  token: string | null,
): void => {
  if (!isBrowser()) {
    return;
  }

  const key = getTenantStorageKey(ACCESS_TOKEN_PREFIX, companyId);
  if (!token) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, token);
};

export const clearAccessTokens = (companyIds: Array<number | string> = []): void => {
  if (!isBrowser()) {
    return;
  }

  companyIds.forEach((companyId) => {
    window.localStorage.removeItem(getTenantStorageKey(ACCESS_TOKEN_PREFIX, companyId));
  });
};

export const clearStoredSession = (companyIds: Array<number | string> = []): void => {
  if (!isBrowser()) {
    return;
  }

  clearAccessTokens(companyIds);
  setCurrentCompanyId(null);
  setLoginToken(null);
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const isOfflineMultiCompanyUnsupported = (companyCount: number): boolean =>
  isOfflineModeEnabled && companyCount > 1;

const companyScopedStorage: StateStorage = {
  getItem: (name) => {
    if (!isBrowser()) {
      return null;
    }

    return window.localStorage.getItem(getTenantStorageKey(name, getCurrentCompanyId()));
  },
  setItem: (name, value) => {
    if (!isBrowser()) {
      return;
    }

    window.localStorage.setItem(getTenantStorageKey(name, getCurrentCompanyId()), value);
  },
  removeItem: (name) => {
    if (!isBrowser()) {
      return;
    }

    window.localStorage.removeItem(getTenantStorageKey(name, getCurrentCompanyId()));
  },
};

export const createCompanyScopedJSONStorage = () =>
  createJSONStorage(() => companyScopedStorage);
