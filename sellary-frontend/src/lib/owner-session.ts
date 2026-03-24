'use client';

export const OWNER_AUTH_STORAGE_KEY = 'owner-auth-storage-v1';
const OWNER_ACCESS_TOKEN_KEY = 'sellary:owner-access-token';

const isBrowser = () => typeof window !== 'undefined';

export const getOwnerAccessToken = (): string | null => {
  if (!isBrowser()) {
    return null;
  }

  return window.localStorage.getItem(OWNER_ACCESS_TOKEN_KEY);
};

export const setOwnerAccessToken = (token: string | null): void => {
  if (!isBrowser()) {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(OWNER_ACCESS_TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(OWNER_ACCESS_TOKEN_KEY, token);
};

export const clearOwnerSession = (): void => {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(OWNER_ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(OWNER_AUTH_STORAGE_KEY);
};
