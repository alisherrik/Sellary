import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerDevice,
  refreshDevice,
  setAccessToken,
  getAccessToken,
  setApiBaseUrl,
  ApiError,
} from '../api';

describe('device auth api', () => {
  beforeEach(async () => {
    await setApiBaseUrl('http://127.0.0.1:8001');
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  it('registerDevice posts name + device_id with the bearer and returns the token', async () => {
    setAccessToken('bearer-xyz');
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        device_id: 'dev-1',
        device_token: 'secret-token',
        name: 'Kassa',
        expires_at: '2026-12-31T00:00:00Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await registerDevice('Kassa', 'dev-1');

    expect(res.device_token).toBe('secret-token');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ name: 'Kassa', device_id: 'dev-1' });
    expect(init.headers.Authorization).toBe('Bearer bearer-xyz');
  });

  it('refreshDevice sends NO Authorization header and stores the new access token', async () => {
    setAccessToken('stale-or-expired');
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'fresh-access',
        token_type: 'bearer',
        expires_at: '2027-01-01T00:00:00Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await refreshDevice('dev-1', 'secret-token');

    expect(res.access_token).toBe('fresh-access');
    expect(getAccessToken()).toBe('fresh-access');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/auth/devices/refresh');
    expect(JSON.parse(init.body)).toEqual({
      device_id: 'dev-1',
      device_token: 'secret-token',
    });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('refreshDevice throws ApiError with status on 401', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'device revoked' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshDevice('dev-1', 'bad')).rejects.toMatchObject({
      status: 401,
    });
    await expect(refreshDevice('dev-1', 'bad')).rejects.toBeInstanceOf(ApiError);
  });
});
