import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  ownerApi: {
    login: vi.fn(),
    session: vi.fn(),
  },
  authApi: {
    login: vi.fn(),
    selectCompany: vi.fn(),
    switchCompany: vi.fn(),
    me: vi.fn(),
  },
}));

import { ownerApi } from '../api';
import { getOwnerAccessToken } from '../owner-session';
import { useOwnerStore } from '../owner-store';
import { useAuthStore } from '../store';

describe('owner-store and tenant session handoff', () => {
  beforeEach(() => {
    localStorage.clear();
    useOwnerStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
    useAuthStore.setState({
      user: null,
      companies: [],
      currentCompany: null,
      loginToken: null,
      accessToken: null,
      isAuthenticated: false,
    });
    vi.clearAllMocks();
  });

  it('logs in and persists the owner token', async () => {
    vi.mocked(ownerApi.login).mockResolvedValue({
      data: {
        access_token: 'owner-token',
        token_type: 'bearer',
        user: {
          id: 1,
          username: 'owner',
          email: 'owner@test.com',
          full_name: 'Owner',
          global_role: 'super_admin',
          is_active: true,
          created_at: '2026-03-19T00:00:00Z',
        },
      },
    } as any);

    await useOwnerStore.getState().login('owner', 'secret');

    expect(useOwnerStore.getState().isAuthenticated).toBe(true);
    expect(getOwnerAccessToken()).toBe('owner-token');
  });

  it('accepts a company session from the owner panel into tenant auth state', () => {
    const session = {
      access_token: 'tenant-token',
      token_type: 'bearer' as const,
      user: {
        id: 1,
        username: 'owner',
        email: 'owner@test.com',
        full_name: 'Owner',
        global_role: 'super_admin' as const,
        is_active: true,
        created_at: '2026-03-19T00:00:00Z',
      },
      current_company: {
        id: 7,
        name: 'Tenant 7',
        slug: 'tenant-7',
        is_active: true,
        role: 'admin' as const,
        is_default: true,
      },
      companies: [
        {
          id: 7,
          name: 'Tenant 7',
          slug: 'tenant-7',
          is_active: true,
          role: 'admin' as const,
          is_default: true,
        },
      ],
    };

    useAuthStore.getState().acceptCompanySession(session);

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().currentCompany?.id).toBe(7);
    expect(useAuthStore.getState().companies).toHaveLength(1);
  });
});
