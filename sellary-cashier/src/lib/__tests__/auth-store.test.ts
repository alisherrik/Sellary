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

});

describe('selectAndBootstrap (device provisioning)', () => {
  it('selects company, registers the device, binds identity, awaits PIN', async () => {
    mockSelectCompany.mockResolvedValue(makeTokenResponse());
    mockGetDeviceAuth.mockResolvedValue(null);
    mockRegisterDevice.mockResolvedValue({
      device_id: 'dev-1', device_token: 'secret',
      name: 'Kassa', expires_at: '2027-01-01T00:00:00Z',
    });
    mockAddSyncEvent.mockResolvedValue(undefined);

    await useAuthStore.getState().selectAndBootstrap('login-token', 10);

    expect(mockSelectCompany).toHaveBeenCalledWith('login-token', 10);
    expect(mockSetAccessToken).toHaveBeenCalledWith('token-abc');
    expect(mockRegisterDevice).toHaveBeenCalledWith('Kassa', expect.any(String));
    expect(mockSaveDeviceCredential).toHaveBeenCalledWith('secret', '2027-01-01T00:00:00Z');
    expect(mockEnsureDeviceAuth).toHaveBeenCalledWith('dev-1');
    expect(mockBindDeviceIdentity).toHaveBeenCalledWith({
      user_id: 1, username: 'cashier', company_id: 10,
      company_name: 'Test Company', user_role: 'cashier',
      device_token_expires_at: '2027-01-01T00:00:00Z', // reg.expires_at
      last_online_auth_at: expect.any(String),
    });
    const state = useAuthStore.getState();
    expect(state.hasDevice).toBe(true);
    expect(state.hasPin).toBe(false);
    expect(state.isAuthenticated).toBe(false); // not until PIN + bootstrap
  });

  it('does not swallow a register failure', async () => {
    mockSelectCompany.mockResolvedValue(makeTokenResponse());
    mockGetDeviceAuth.mockResolvedValue(null);
    mockRegisterDevice.mockRejectedValue(new Error('rate limited'));
    mockAddSyncEvent.mockResolvedValue(undefined);

    await expect(
      useAuthStore.getState().selectAndBootstrap('login-token', 10)
    ).rejects.toThrow('register device: rate limited');
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });
});

describe('completePinSetup', () => {
  it('sets the PIN, pulls the catalog, and authenticates', async () => {
    mockSavePin.mockResolvedValue(undefined);
    mockGetAccessToken.mockReturnValue('token-abc');
    mockFetchBootstrap.mockResolvedValue(makeBootstrap());
    mockAddSyncEvent.mockResolvedValue(undefined);

    await useAuthStore.getState().completePinSetup('1234');

    expect(mockSavePin).toHaveBeenCalledWith('1234');
    expect(mockFetchBootstrap).toHaveBeenCalled();
    expect(mockUpsertProducts).toHaveBeenCalledWith([]);
    expect(mockSaveCashierSession).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.hasPin).toBe(true);
    expect(state.isAuthenticated).toBe(true);
    expect(state.companyId).toBe(10);
  });
});

describe('logout', () => {
  it('hard-blocks while unsynced sales exist', async () => {
    mockGetUnsyncedCount.mockResolvedValue(3);
    useAuthStore.setState({ isAuthenticated: true });

    await expect(useAuthStore.getState().logout()).rejects.toThrow(/3/);
    expect(mockClearDeviceCredential).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('clears device + PIN + session when nothing is unsynced', async () => {
    mockGetUnsyncedCount.mockResolvedValue(0);
    mockClearCashierSession.mockResolvedValue(undefined);
    mockClearDeviceCredential.mockResolvedValue(undefined);
    mockClearPin.mockResolvedValue(undefined);
    useAuthStore.setState({
      isAuthenticated: true, hasDevice: true, hasPin: true, needsReauth: true,
    });

    await useAuthStore.getState().logout();

    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    expect(mockClearCashierSession).toHaveBeenCalled();
    expect(mockClearDeviceCredential).toHaveBeenCalled();
    expect(mockClearPin).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.hasDevice).toBe(false);
    expect(state.hasPin).toBe(false);
    expect(state.needsReauth).toBe(false);
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

describe('ensureFreshAccessToken', () => {
  it('refreshes when the token is near expiry and stores the new credential', async () => {
    mockLoadDeviceCredential.mockResolvedValue({
      deviceToken: 'secret', expiresAt: '2027-01-01T00:00:00Z',
    });
    mockLoadCashierSession.mockResolvedValue({
      accessToken: 'old', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      companyId: 10, companyName: 'T', userId: 1, username: 'c', userRole: 'cashier',
    });
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', company_id: 10, company_name: 'T',
      user_id: 1, username: 'c', user_role: 'cashier',
    });
    mockRefreshDevice.mockResolvedValue({
      access_token: 'fresh', token_type: 'bearer',
      expires_at: '2027-06-01T00:00:00Z',
    });

    await useAuthStore.getState().ensureFreshAccessToken();

    expect(mockRefreshDevice).toHaveBeenCalledWith('dev-1', 'secret');
    expect(mockSetAccessToken).toHaveBeenCalledWith('fresh');
    expect(mockSaveDeviceCredential).toHaveBeenCalledWith('secret', '2027-06-01T00:00:00Z');
    expect(useAuthStore.getState().needsReauth).toBe(false);
  });

  it('skips the network when the token is comfortably fresh', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue({
      accessToken: 'ok', expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      companyId: 10, companyName: 'T', userId: 1, username: 'c', userRole: 'cashier',
    });

    await useAuthStore.getState().ensureFreshAccessToken();

    expect(mockRefreshDevice).not.toHaveBeenCalled();
  });

  it('sets needsReauth on a 401/403 but does not throw', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null); // no token → needs refresh
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1' });
    const { ApiError } = await import('../api');
    mockRefreshDevice.mockRejectedValue(new ApiError('revoked', 403));

    await expect(useAuthStore.getState().ensureFreshAccessToken()).resolves.toBeUndefined();
    expect(useAuthStore.getState().needsReauth).toBe(true);
  });

  it('stays silent (no needsReauth) on a network error', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null);
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1' });
    mockRefreshDevice.mockRejectedValue(new Error('Network failure'));

    await useAuthStore.getState().ensureFreshAccessToken();

    expect(useAuthStore.getState().needsReauth).toBe(false);
  });

  it('is single-flight (concurrent calls collapse to one refresh)', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null);
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1' });
    mockRefreshDevice.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({
        access_token: 'fresh', token_type: 'bearer',
        expires_at: '2027-06-01T00:00:00Z',
      }), 30))
    );

    await Promise.all([
      useAuthStore.getState().ensureFreshAccessToken(),
      useAuthStore.getState().ensureFreshAccessToken(),
    ]);

    expect(mockRefreshDevice).toHaveBeenCalledTimes(1);
  });
});
