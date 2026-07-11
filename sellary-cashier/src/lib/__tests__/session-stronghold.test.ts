import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake Stronghold whose `save()` we can observe. This exercises the REAL
// Stronghold code path (unlike session-device.test.ts, which forces the
// plugin-store fallback by leaving Stronghold unmocked so it throws).
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
  return {
    Stronghold: { load: vi.fn().mockResolvedValue(stronghold) },
    Client: class {},
    Store: class {},
  };
});

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

import { saveDeviceCredential } from '../session';

describe('Stronghold persistence (device token must survive app restart)', () => {
  beforeEach(() => {
    strongholdSave.mockClear();
    shStoreInsert.mockClear();
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
});
