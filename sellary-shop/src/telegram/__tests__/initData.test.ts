import { vi, describe, it, expect, afterEach } from 'vitest';
import { parseInitData } from '../initData';

describe('parseInitData', () => {
  it('returns null for empty string', () => {
    expect(parseInitData('')).toBeNull();
  });

  it('parses a valid initData query string', () => {
    const user = JSON.stringify({ id: 42, first_name: 'Ali', username: 'ali' });
    const initDataStr = `auth_date=1700000000&user=${encodeURIComponent(user)}&hash=abc`;
    const result = parseInitData(initDataStr);
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe(42);
    expect(result!.user.first_name).toBe('Ali');
    expect(result!.authDate).toBe(1700000000);
    expect(result!.hash).toBe('abc');
  });

  it('returns null when user field is missing', () => {
    expect(parseInitData('auth_date=1&hash=x')).toBeNull();
  });

  it('returns null when auth_date is missing', () => {
    const user = encodeURIComponent(JSON.stringify({ id: 1 }));
    expect(parseInitData(`user=${user}&hash=x`)).toBeNull();
  });
});

/**
 * Dev-gate tests: vi.stubEnv patches import.meta.env at runtime.
 * vi.resetModules() ensures the module is re-evaluated after the env changes.
 */
describe('getInitDataString dev-gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns dev fallback (contains auth_date) when DEV=true and no Telegram WebApp', async () => {
    vi.stubEnv('DEV', true as unknown as string);
    vi.resetModules();
    const { getInitDataString } = await import('../initData');
    const result = getInitDataString();
    expect(result).toContain('auth_date');
  });

  it('returns empty string when DEV=false and no Telegram WebApp', async () => {
    vi.stubEnv('DEV', false as unknown as string);
    vi.resetModules();
    const { getInitDataString } = await import('../initData');
    const result = getInitDataString();
    expect(result).toBe('');
  });
});
