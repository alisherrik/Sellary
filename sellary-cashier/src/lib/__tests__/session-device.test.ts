import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDeviceCredential,
  loadDeviceCredential,
  clearDeviceCredential,
} from '../session';

describe('device credential (store fallback)', () => {
  beforeEach(async () => {
    await clearDeviceCredential();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadDeviceCredential()).toBeNull();
  });

  it('round-trips token + expiry', async () => {
    await saveDeviceCredential('dev-token-abc', '2026-12-31T00:00:00.000Z');
    const cred = await loadDeviceCredential();
    expect(cred).toEqual({
      deviceToken: 'dev-token-abc',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
  });

  it('clear removes the credential', async () => {
    await saveDeviceCredential('dev-token-abc', '2026-12-31T00:00:00.000Z');
    await clearDeviceCredential();
    expect(await loadDeviceCredential()).toBeNull();
  });
});
