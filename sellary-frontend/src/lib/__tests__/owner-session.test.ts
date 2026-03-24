import { describe, expect, it, beforeEach } from 'vitest';

import { clearOwnerSession, getOwnerAccessToken, setOwnerAccessToken } from '../owner-session';

describe('owner-session', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and reads the owner access token', () => {
    setOwnerAccessToken('owner-token');

    expect(getOwnerAccessToken()).toBe('owner-token');
  });

  it('clears the owner access token and owner auth storage', () => {
    localStorage.setItem('owner-auth-storage-v1', '{"state":{}}');
    setOwnerAccessToken('owner-token');

    clearOwnerSession();

    expect(getOwnerAccessToken()).toBeNull();
    expect(localStorage.getItem('owner-auth-storage-v1')).toBeNull();
  });
});
