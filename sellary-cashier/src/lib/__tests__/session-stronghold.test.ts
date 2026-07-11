import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake Stronghold whose `save()` we can observe. This exercises the REAL
// Stronghold code path (unlike session-device.test.ts, which forces the
// plugin-store fallback by leaving Stronghold unmocked so it throws).
const strongholdLoad = vi.hoisted(() => vi.fn());
const strongholdSave = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const shStoreInsert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const shStoreRemove = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const shStoreGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('@tauri-apps/plugin-stronghold', () => {
  const store = { insert: shStoreInsert, remove: shStoreRemove, get: shStoreGet };
  const client = { getStore: () => store };
  const stronghold = {
    loadClient: vi.fn().mockResolvedValue(client),
    createClient: vi.fn().mockResolvedValue(client),
    save: strongholdSave,
  };
  strongholdLoad.mockResolvedValue(stronghold);
  return {
    Stronghold: { load: strongholdLoad },
    Client: class {},
    Store: class {},
  };
});

// appDataDir MUST resolve to an absolute directory; the fix builds the snapshot
// path from it. A bare relative filename resolves against the process CWD, which
// is unstable across app launches and loses the device token.
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
}));

const memStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn(async (k: string) => memStore.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => {
        memStore.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        memStore.delete(k);
      }),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../db', () => ({ getDeviceAuth: vi.fn(), setPinHash: vi.fn() }));

import { saveDeviceCredential, loadDeviceCredential } from '../session';

describe('Stronghold persistence (device token must survive app restart)', () => {
  beforeEach(() => {
    strongholdSave.mockClear();
    shStoreInsert.mockClear();
    shStoreGet.mockClear();
    shStoreGet.mockResolvedValue(null);
    memStore.clear();
  });

  it('persists the snapshot AFTER inserting the device token', async () => {
    await saveDeviceCredential('dev-token-xyz', '2027-01-01T00:00:00.000Z');

    expect(shStoreInsert).toHaveBeenCalled();
    // The regression: the token is written into the in-memory vault but the
    // snapshot is only saved at load time (before the insert), so on the next
    // app launch the device token is gone -> restoreSession() fails -> login.
    // A save() MUST occur after the insert.
    const lastInsert = Math.max(...shStoreInsert.mock.invocationCallOrder);
    const lastSave = Math.max(...strongholdSave.mock.invocationCallOrder);
    expect(lastSave).toBeGreaterThan(lastInsert);
  });

  it('loads the snapshot from an ABSOLUTE appDataDir path (not a relative filename)', async () => {
    await saveDeviceCredential('dev-token-xyz', '2027-01-01T00:00:00.000Z');

    // Stronghold.load is called once for the module lifetime (memoized store).
    expect(strongholdLoad).toHaveBeenCalled();
    const snapshotArg = strongholdLoad.mock.calls[0][0] as string;
    expect(snapshotArg).toContain('/mock/appdata');
    expect(snapshotArg).toContain('sellary-stronghold.snapshot');
    // Must NOT be the bare relative name that resolves against the unstable CWD.
    expect(snapshotArg).not.toBe('sellary-stronghold.snapshot');
  });

  it('recovers the device token from the plugin-store mirror when Stronghold is empty', async () => {
    // Simulate a lost/fresh Stronghold snapshot (the pre-v0.2.3 bug): the vault
    // loads but has no device token. The mirror written by saveDeviceCredential
    // must still let loadDeviceCredential return the credential.
    shStoreGet.mockResolvedValue(null);
    await saveDeviceCredential('recover-me', '2027-02-02T00:00:00.000Z');

    const cred = await loadDeviceCredential();
    expect(cred).toEqual({
      deviceToken: 'recover-me',
      expiresAt: '2027-02-02T00:00:00.000Z',
    });
  });
});
