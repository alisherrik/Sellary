import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSyncNow, mockRefreshCatalog } = vi.hoisted(() => ({
  mockSyncNow: vi.fn(),
  mockRefreshCatalog: vi.fn(),
}));

vi.mock('../sync-engine', () => ({
  syncNow: mockSyncNow,
  refreshCatalog: mockRefreshCatalog,
}));

import { useSyncStore, initialSyncState } from '../sync-store';

beforeEach(() => {
  vi.clearAllMocks();
  mockSyncNow.mockResolvedValue(undefined);
  mockRefreshCatalog.mockResolvedValue(undefined);
  useSyncStore.setState(initialSyncState);
});

describe('sync-store', () => {
  it('starts from the offline/idle initial snapshot', () => {
    const s = useSyncStore.getState();
    expect(s.online).toBe(false);
    expect(s.engineState).toBe('idle');
    expect(s.isSyncing).toBe(false);
    expect(s.unsyncedCount).toBe(0);
    expect(s.needsAttentionCount).toBe(0);
    expect(s.lastSyncedAt).toBeNull();
    expect(s.nextRetryAt).toBeNull();
    expect(s.catalogRefreshedAt).toBeNull();
    expect(s.lastWarningCount).toBe(0);
    expect(s.hasRepeatedFailures).toBe(false);
  });

  it('setOnline flips only the online flag', () => {
    useSyncStore.getState().setOnline(true);
    expect(useSyncStore.getState().online).toBe(true);
  });

  it('setEngineState derives isSyncing from the syncing state', () => {
    useSyncStore.getState().setEngineState('syncing');
    expect(useSyncStore.getState().isSyncing).toBe(true);
    useSyncStore.getState().setEngineState('backing_off');
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it('patch merges a partial snapshot', () => {
    useSyncStore.getState().patch({ unsyncedCount: 3, lastError: 'boom' });
    const s = useSyncStore.getState();
    expect(s.unsyncedCount).toBe(3);
    expect(s.lastError).toBe('boom');
  });

  it('syncNow action delegates to the engine', async () => {
    await useSyncStore.getState().syncNow();
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  it('refreshCatalog action delegates to the engine', async () => {
    await useSyncStore.getState().refreshCatalog();
    expect(mockRefreshCatalog).toHaveBeenCalledTimes(1);
  });
});
