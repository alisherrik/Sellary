import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLogin,
  mockSelectCompany,
  mockSetAccessToken,
  mockGetAccessToken,
  mockFetchBootstrap,
  mockRegisterDevice,
  mockRefreshDevice,
  mockUpsertProducts,
  mockUpsertCategories,
  mockSetMeta,
  mockAddSyncEvent,
  mockGetDeviceAuth,
  mockEnsureDeviceAuth,
  mockBindDeviceIdentity,
  mockRecordPinFailure,
  mockResetPinFailures,
  mockGetUnsyncedCount,
  mockSetStoreValue,
  mockLoadCashierSession,
  mockSaveCashierSession,
  mockClearCashierSession,
  mockSaveDeviceCredential,
  mockLoadDeviceCredential,
  mockClearDeviceCredential,
  mockSavePin,
  mockVerifyPin,
  mockClearPin,
} = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockSelectCompany: vi.fn(),
  mockSetAccessToken: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockFetchBootstrap: vi.fn(),
  mockRegisterDevice: vi.fn(),
  mockRefreshDevice: vi.fn(),
  mockUpsertProducts: vi.fn(),
  mockUpsertCategories: vi.fn(),
  mockSetMeta: vi.fn(),
  mockAddSyncEvent: vi.fn(),
  mockGetDeviceAuth: vi.fn(),
  mockEnsureDeviceAuth: vi.fn(),
  mockBindDeviceIdentity: vi.fn(),
  mockRecordPinFailure: vi.fn(),
  mockResetPinFailures: vi.fn(),
  mockGetUnsyncedCount: vi.fn(),
  mockSetStoreValue: vi.fn(),
  mockLoadCashierSession: vi.fn(),
  mockSaveCashierSession: vi.fn(),
  mockClearCashierSession: vi.fn(),
  mockSaveDeviceCredential: vi.fn(),
  mockLoadDeviceCredential: vi.fn(),
  mockClearDeviceCredential: vi.fn(),
  mockSavePin: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockClearPin: vi.fn(),
}));

vi.mock('../api', () => ({
  login: mockLogin,
  selectCompany: mockSelectCompany,
  setAccessToken: mockSetAccessToken,
  getAccessToken: mockGetAccessToken,
  fetchBootstrap: mockFetchBootstrap,
  registerDevice: mockRegisterDevice,
  refreshDevice: mockRefreshDevice,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(m: string, s: number) { super(m); this.status = s; }
  },
}));

vi.mock('../db', () => ({
  upsertProducts: mockUpsertProducts,
  upsertCategories: mockUpsertCategories,
  setMeta: mockSetMeta,
  addSyncEvent: mockAddSyncEvent,
  getDeviceAuth: mockGetDeviceAuth,
  ensureDeviceAuth: mockEnsureDeviceAuth,
  bindDeviceIdentity: mockBindDeviceIdentity,
  recordPinFailure: mockRecordPinFailure,
  resetPinFailures: mockResetPinFailures,
  getUnsyncedCount: mockGetUnsyncedCount,
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
  saveDeviceCredential: mockSaveDeviceCredential,
  loadDeviceCredential: mockLoadDeviceCredential,
  clearDeviceCredential: mockClearDeviceCredential,
  savePin: mockSavePin,
  verifyPin: mockVerifyPin,
  clearPin: mockClearPin,
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
    isAuthenticated: false, isBootstrapping: false,
    hasDevice: false, hasPin: false, isLocked: false,
    lockedUntil: null, needsReauth: false,
    companyId: null, companyName: null, userId: null, username: null, userRole: null,
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
    it('opens (returns true) on an EXPIRED access_token when device + PIN exist', async () => {
      mockGetDeviceAuth.mockResolvedValue({
        device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
        user_id: 1, username: 'cashier', company_id: 10,
        company_name: 'Test', user_role: 'cashier',
      });
      mockLoadDeviceCredential.mockResolvedValue({
        deviceToken: 'secret', expiresAt: '2027-01-01T00:00:00Z',
      });
      mockLoadCashierSession.mockResolvedValue({
        accessToken: 'expired-token', expiresAt: '2020-01-01T00:00:00Z',
        companyId: 10, companyName: 'Test', userId: 1,
        username: 'cashier', userRole: 'cashier',
      });

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(true);
      const state = useAuthStore.getState();
      expect(state.hasDevice).toBe(true);
      expect(state.hasPin).toBe(true);
      expect(state.isAuthenticated).toBe(false); // gated on PIN unlock
      expect(mockClearCashierSession).not.toHaveBeenCalled(); // never wiped on expiry
      expect(mockSetAccessToken).toHaveBeenCalledWith('expired-token');
      expect(state.companyId).toBe(10);
    });

    it('returns false when the device is not provisioned', async () => {
      mockGetDeviceAuth.mockResolvedValue(null);
      mockLoadDeviceCredential.mockResolvedValue(null);

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(false);
      expect(useAuthStore.getState().hasDevice).toBe(false);
    });

    it('returns false when device exists but PIN was never set', async () => {
      mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1', pin_hash: null });
      mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });

      const result = await useAuthStore.getState().restoreSession();

      expect(result).toBe(false);
      expect(useAuthStore.getState().hasPin).toBe(false);
    });

    it('reflects an active lockout from device_auth', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      mockGetDeviceAuth.mockResolvedValue({
        device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: future,
        user_id: 1, username: 'c', company_id: 10, company_name: 'T', user_role: 'cashier',
      });
      mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
      mockLoadCashierSession.mockResolvedValue(null);

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().isLocked).toBe(true);
      expect(useAuthStore.getState().lockedUntil).toBe(future);
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

describe('unlockWithPin', () => {
  it('authenticates on a correct PIN and resets failure counters', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      failed_pin_attempts: 2, user_id: 1, username: 'c',
      company_id: 10, company_name: 'T', user_role: 'cashier',
    });
    mockVerifyPin.mockResolvedValue(true);
    mockLoadDeviceCredential.mockResolvedValue(null); // no bg refresh path

    const ok = await useAuthStore.getState().unlockWithPin('1234');

    expect(ok).toBe(true);
    expect(mockResetPinFailures).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLocked).toBe(false);
    expect(state.companyId).toBe(10);
  });

  it('records a failure without locking below the threshold', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      failed_pin_attempts: 1,
    });
    mockVerifyPin.mockResolvedValue(false);

    const ok = await useAuthStore.getState().unlockWithPin('0000');

    expect(ok).toBe(false);
    expect(mockRecordPinFailure).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().isLocked).toBe(false);
  });

  it('locks after the 5th consecutive failure', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      failed_pin_attempts: 4, // this failure makes 5
    });
    mockVerifyPin.mockResolvedValue(false);

    const ok = await useAuthStore.getState().unlockWithPin('0000');

    expect(ok).toBe(false);
    const [lockArg] = mockRecordPinFailure.mock.calls[0];
    expect(typeof lockArg).toBe('string');
    expect(Date.parse(lockArg)).toBeGreaterThan(Date.now());
    expect(useAuthStore.getState().isLocked).toBe(true);
  });

  it('refuses while an unexpired lockout is active', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: future,
    });

    const ok = await useAuthStore.getState().unlockWithPin('1234');

    expect(ok).toBe(false);
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isLocked).toBe(true);
  });
});
