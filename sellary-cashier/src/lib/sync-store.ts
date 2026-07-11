import { create } from 'zustand';

export type EngineState = 'idle' | 'syncing' | 'backing_off' | 'offline';

export interface SyncSnapshot {
  online: boolean;
  engineState: EngineState;
  isSyncing: boolean;
  unsyncedCount: number;
  needsAttentionCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  catalogRefreshedAt: string | null;
  lastWarningCount: number;
  hasRepeatedFailures: boolean;
}

export interface SyncStore extends SyncSnapshot {
  setOnline: (online: boolean) => void;
  setEngineState: (engineState: EngineState) => void;
  patch: (partial: Partial<SyncSnapshot>) => void;
  syncNow: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
}

export const initialSyncState: SyncSnapshot = {
  online: false,
  engineState: 'idle',
  isSyncing: false,
  unsyncedCount: 0,
  needsAttentionCount: 0,
  lastSyncedAt: null,
  lastError: null,
  nextRetryAt: null,
  catalogRefreshedAt: null,
  lastWarningCount: 0,
  hasRepeatedFailures: false,
};

export const useSyncStore = create<SyncStore>((set) => ({
  ...initialSyncState,
  setOnline: (online) => set({ online }),
  setEngineState: (engineState) =>
    set({ engineState, isSyncing: engineState === 'syncing' }),
  patch: (partial) => set(partial),
  // Dynamic import breaks the static engine→store cycle (engine imports the store statically).
  syncNow: async () => {
    const { syncNow } = await import('./sync-engine');
    await syncNow();
  },
  refreshCatalog: async () => {
    const { refreshCatalog } = await import('./sync-engine');
    await refreshCatalog();
  },
}));
