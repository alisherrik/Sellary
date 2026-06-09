import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLogin,
  mockSelectCompany,
  mockSetAccessToken,
  mockFetchBootstrap,
  mockUpsertProducts,
  mockUpsertCategories,
  mockSetMeta,
  mockAddSyncEvent,
  mockSetStoreValue,
  mockLoadCashierSession,
  mockSaveCashierSession,
  mockClearCashierSession,
} = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockSelectCompany: vi.fn(),
  mockSetAccessToken: vi.fn(),
  mockFetchBootstrap: vi.fn(),
  mockUpsertProducts: vi.fn(),
  mockUpsertCategories: vi.fn(),
  mockSetMeta: vi.fn(),
  mockAddSyncEvent: vi.fn(),
  mockSetStoreValue: vi.fn(),
  mockLoadCashierSession: vi.fn(),
  mockSaveCashierSession: vi.fn(),
  mockClearCashierSession: vi.fn(),
}));

vi.mock('../api', () => ({
  login: mockLogin,
  selectCompany: mockSelectCompany,
  setAccessToken: mockSetAccessToken,
  fetchBootstrap: mockFetchBootstrap,
}));

vi.mock('../db', () => ({
  upsertProducts: mockUpsertProducts,
  upsertCategories: mockUpsertCategories,
  setMeta: mockSetMeta,
  addSyncEvent: mockAddSyncEvent,
}));

vi.mock('../storage', () => ({
  setStoreValue: mockSetStoreValue,
}));

vi.mock('../session', () => ({
  loadCashierSession: mockLoadCashierSession,
  saveCashierSession: mockSaveCashierSession,
  clearCashierSession: mockClearCashierSession,
  isSessionExpired: vi.fn(() => false),
  getTokenExpiresAt: vi.fn(() => '2026-06-01T00:00:00Z'),
}));

import { useAuthStore } from '../auth-store';

function makeTokenResponse() {
  return {
    access_token: 'token-abc',
    token_type: 'bearer',
    user: {
      id: 1,
      username: 'cashier',
      email: 'cashier@test.com',
      full_name: null,
      global_role: 'user',
      is_active: true,
      created_at: '2025-01-01T00:00:00Z',
    },
    current_company: {
      id: 10,
      name: 'Test Company',
      slug: 'test-company',
      is_active: true,
      role: 'cashier',
      is_default: true,
    },
    companies: [],
  };
}

function makeBootstrap() {
  return {
    company_id: 10,
    company_name: 'Test Company',
    user_id: 1,
    user_username: 'cashier',
    user_role: 'cashier',
    server_time: '2025-01-01T00:00:00Z',
    products: [],
    categories: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: false,
    isBootstrapping: false,
    companyId: null,
    companyName: null,
    userId: null,
    username: null,
    userRole: null,
  });
});

describe('useAuthStore', () => {
  describe('loginUser', () => {
    it('delegates to api login', async () => {
      const loginResponse = {
        login_token: 'lt-123',
        token_type: 'bearer',
        user: { id: 1, username: 'admin', email: 'admin@test.com', full_name: null, global_role: 'admin', is_active: true, created_at: '2025-01-01T00:00:00Z' },
        companies: [],
      };
      mockLogin.mockResolvedValue(loginResponse);

      const result = await useAuthStore.getState().loginUser('admin', 'password');

      expect(mockLogin).toHaveBeenCalledWith('admin', 'password');
      expect(result).toEqual(loginResponse);
    });
  });

  describe('selectAndBootstrap', () => {
    it('bootstraps and sets authenticated state on success', async () => {
      mockSelectCompany.mockResolvedValue(makeTokenResponse());
      mockFetchBootstrap.mockResolvedValue(makeBootstrap());
      mockUpsertCategories.mockResolvedValue(undefined);
      mockUpsertProducts.mockResolvedValue(undefined);
      mockSetMeta.mockResolvedValue(undefined);
      mockSetStoreValue.mockResolvedValue(undefined);
      mockAddSyncEvent.mockResolvedValue(undefined);

      await useAuthStore.getState().selectAndBootstrap('login-token', 10);

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.isBootstrapping).toBe(false);
      expect(state.companyId).toBe(10);
      expect(state.companyName).toBe('Test Company');
      expect(state.userId).toBe(1);
      expect(state.username).toBe('cashier');
      expect(state.userRole).toBe('cashier');

      expect(mockSelectCompany).toHaveBeenCalledWith('login-token', 10);
      expect(mockSetAccessToken).toHaveBeenCalledWith('token-abc');
      expect(mockFetchBootstrap).toHaveBeenCalled();
      expect(mockUpsertCategories).toHaveBeenCalledWith([]);
      expect(mockUpsertProducts).toHaveBeenCalledWith([]);
      expect(mockSetMeta).toHaveBeenCalledWith('last_bootstrap_time', '2025-01-01T00:00:00Z');
      expect(mockSetMeta).toHaveBeenCalledWith('last_company_id', '10');
      expect(mockSetStoreValue).toHaveBeenCalledWith('last_company_id', 10);
    });

    it('sets isBootstrapping to false and throws on selectCompany failure', async () => {
      mockSelectCompany.mockRejectedValue(new Error('Invalid token'));

      await expect(
        useAuthStore.getState().selectAndBootstrap('bad-token', 10)
      ).rejects.toThrow('select company: Invalid token');

      expect(useAuthStore.getState().isBootstrapping).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('sets isBootstrapping to false and throws on fetchBootstrap failure', async () => {
      mockSelectCompany.mockResolvedValue(makeTokenResponse());
      mockFetchBootstrap.mockRejectedValue(new Error('Server error'));

      await expect(
        useAuthStore.getState().selectAndBootstrap('login-token', 10)
      ).rejects.toThrow('download bootstrap catalog: Server error');

      expect(useAuthStore.getState().isBootstrapping).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('restoreSession', () => {
    it('restores a valid persisted session', async () => {
      mockLoadCashierSession.mockResolvedValue({
        accessToken: 'token-xyz',
        expiresAt: '2026-06-01T00:00:00Z',
        companyId: 10,
        companyName: 'Test Company',
        userId: 1,
        username: 'cashier',
        userRole: 'cashier',
      });

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(true);
      expect(mockSetAccessToken).toHaveBeenCalledWith('token-xyz');
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.companyId).toBe(10);
      expect(state.companyName).toBe('Test Company');
      expect(state.userId).toBe(1);
      expect(state.username).toBe('cashier');
      expect(state.userRole).toBe('cashier');
    });

    it('returns false when no persisted session exists', async () => {
      mockLoadCashierSession.mockResolvedValue(null);

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('clears expired persisted session and returns false', async () => {
      mockLoadCashierSession.mockResolvedValue({
        accessToken: 'token-expired',
        expiresAt: '2020-01-01T00:00:00Z',
        companyId: 10,
        companyName: 'Test',
        userId: 1,
        username: 'cashier',
        userRole: 'cashier',
      });
      const { isSessionExpired } = await import('../session');
      vi.mocked(isSessionExpired).mockReturnValue(true);

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(false);
      expect(mockClearCashierSession).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('clears access token and resets auth state', async () => {
      mockClearCashierSession.mockResolvedValue(undefined);
      useAuthStore.setState({
        isAuthenticated: true,
        companyId: 10,
        companyName: 'Test',
        userId: 1,
        username: 'cashier',
        userRole: 'cashier',
      });

      await useAuthStore.getState().logout();

      expect(mockSetAccessToken).toHaveBeenCalledWith(null);
      expect(mockClearCashierSession).toHaveBeenCalled();
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.companyId).toBeNull();
      expect(state.companyName).toBeNull();
      expect(state.userId).toBeNull();
      expect(state.username).toBeNull();
      expect(state.userRole).toBeNull();
    });
  });
});
