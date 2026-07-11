import { checkHealth } from './api';
import { pushOnce, pullCatalog } from './sync-service';
import {
  getSendableSales,
  markSaleSyncing,
  markSaleSynced,
  markTransientFailure,
  markPermanentFailure,
  recoverSyncingSales,
  getUnsyncedCount,
  getNeedsAttentionCount,
  getMeta,
  setMeta,
  addSyncEvent,
} from './db';
import { useSyncStore } from './sync-store';
import { getErrorMessage } from './error';
import { toast } from 'react-hot-toast';

export type SyncReason =
  | 'periodic'
  | 'reconnect'
  | 'focus'
  | 'post-sale'
  | 'manual'
  | 'coalesced';

const REPEATED_FAILURE_THRESHOLD = 8; // spec §4.7: retry_count >= 8 is a "repeated failure"

export interface SyncPassResult {
  synced: number;
  permanentFailed: number;
  transientFailed: number;
  skipped: boolean;
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000;
const BACKOFF_JITTER = 0.2;
const HEALTH_TIMEOUT_MS = 4_000;
const CATALOG_REFRESH_INTERVAL_MS = 15 * 60_000;
const PERIODIC_INTERVAL_MS = 30_000;
const HEALTH_INTERVAL_MS = 10_000;

export function backoffMs(retryCount: number, rand: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, retryCount));
  const jitter = 1 + (rand() * 2 - 1) * BACKOFF_JITTER; // 1 ± 0.2
  const capped = Math.min(BACKOFF_CAP_MS * (1 + BACKOFF_JITTER), exp * jitter);
  return Math.round(Math.max(0, capped));
}

function nowIso(): string {
  return new Date().toISOString();
}

async function healthPing(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([checkHealth(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function refreshCounts(): Promise<void> {
  const [unsynced, needsAttention] = await Promise.all([
    getUnsyncedCount(),
    getNeedsAttentionCount(),
  ]);
  useSyncStore.getState().patch({
    unsyncedCount: unsynced,
    needsAttentionCount: needsAttention,
  });
}

export async function maybeRefreshCatalog(force = false): Promise<void> {
  const last = await getMeta('last_catalog_pull_at');
  const due =
    force || !last || Date.now() - new Date(last).getTime() >= CATALOG_REFRESH_INTERVAL_MS;
  if (!due) return;
  const res = await pullCatalog();
  useSyncStore.getState().patch({ catalogRefreshedAt: nowIso() });
  await addSyncEvent('catalog', 'completed', `products=${res.products} categories=${res.categories}`);
}

// --- single-flight + coalescing (Task 4 wires the public entry point) ---
let inFlight: Promise<SyncPassResult> | null = null;
let rerunRequested = false;
let rerunForce = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function requestSync(
  reason: SyncReason,
  opts?: { force?: boolean },
): Promise<SyncPassResult> {
  if (inFlight) {
    // Coalesce: remember a force request so the follow-up pass re-sends permanent-failed rows.
    rerunRequested = true;
    if (opts?.force) rerunForce = true;
    return inFlight;
  }
  const force = opts?.force ?? false;
  inFlight = runPass(reason, force).finally(() => {
    inFlight = null;
    if (rerunRequested) {
      rerunRequested = false;
      const nextForce = rerunForce;
      rerunForce = false;
      void requestSync('coalesced', { force: nextForce });
    }
  });
  return inFlight;
}

export function syncNow(): Promise<SyncPassResult> {
  return requestSync('manual');
}

export async function refreshCatalog(): Promise<{ products: number; categories: number }> {
  const res = await pullCatalog();
  useSyncStore.getState().patch({ catalogRefreshedAt: nowIso() });
  await addSyncEvent('catalog', 'completed', `manual products=${res.products} categories=${res.categories}`);
  return res;
}

function scheduleRetry(): void {
  const next = useSyncStore.getState().nextRetryAt;
  if (!next) return;
  const delay = Math.max(0, new Date(next).getTime() - Date.now());
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestSync('periodic');
  }, delay);
}

async function runPass(reason: SyncReason, force = false): Promise<SyncPassResult> {
  const store = useSyncStore.getState();
  store.setEngineState('syncing');

  const online = await healthPing();
  store.setOnline(online);
  if (!online) {
    store.setEngineState('offline');
    await addSyncEvent('sync', 'skipped', `offline (${reason})`);
    await refreshCounts();
    return { synced: 0, permanentFailed: 0, transientFailed: 0, skipped: true };
  }

  await recoverSyncingSales(nowIso());

  let synced = 0;
  let permanentFailed = 0;
  let transientFailed = 0;
  let warningCount = 0;
  let transportError: string | null = null;

  // force ⇒ also re-send permanent-failed rows (contract §4.2, the History "Повторить" path).
  const sendable = await getSendableSales(nowIso(), force ? { includePermanent: true } : undefined);
  if (sendable.length > 0) {
    for (const s of sendable) {
      await markSaleSyncing(s.id);
    }
    try {
      const results = await pushOnce(sendable);
      const idByClientId = new Map(sendable.map((s) => [s.client_sale_id, s.id]));
      for (const r of results) {
        const localId = idByClientId.get(r.client_sale_id);
        if (localId == null) continue;
        idByClientId.delete(r.client_sale_id);
        warningCount += r.warnings?.length ?? 0; // oversell positions the server tolerated
        if (r.status === 'synced' || r.status === 'duplicate') {
          await markSaleSynced(localId, r.sale_id ?? null);
          synced++;
        } else {
          await markPermanentFailure(localId, r.error || 'Unknown error');
          permanentFailed++;
        }
      }
      // Any client_sale_id left in idByClientId had no result -> left 'syncing', cleaned next pass.
    } catch (e) {
      transportError = getErrorMessage(e, 'Sync error');
      const ids = sendable.map((s) => s.id);
      const maxRetry = sendable.reduce((m, s) => Math.max(m, s.retry_count ?? 0), 0);
      const next = new Date(Date.now() + backoffMs(maxRetry)).toISOString();
      await markTransientFailure(ids, next, transportError);
      transientFailed = ids.length;
      store.patch({
        lastError: transportError,
        nextRetryAt: next,
        hasRepeatedFailures: maxRetry >= REPEATED_FAILURE_THRESHOLD, // spec §4.7 chip
      });
    }
  }

  // Pull only if the push did not just raise a transport error (server stock now reflects synced sales).
  if (!transportError) {
    try {
      await maybeRefreshCatalog();
    } catch (e) {
      await addSyncEvent('catalog', 'error', getErrorMessage(e, 'Catalog refresh failed'));
    }
  }

  await refreshCounts();
  store.patch({ lastWarningCount: warningCount });

  // Spec §5.4 surfacing: oversell + mixed-batch outcomes get user-visible toasts.
  if (warningCount > 0) {
    toast(`Синхронизировано, перерасход: ${warningCount} позиций`, {
      icon: '⚠️',
      style: { background: '#f59e0b', color: '#111827' }, // amber
    });
  }
  if (synced > 0 && permanentFailed > 0) {
    toast(`Отправлено ${synced} · требует внимания ${permanentFailed}`);
  }

  if (synced > 0) {
    store.patch({ lastSyncedAt: nowIso(), lastError: null });
    await setMeta('last_sync_at', nowIso());
  }
  if (transientFailed > 0) {
    store.setEngineState('backing_off');
    scheduleRetry();
  } else {
    store.setEngineState('idle');
    store.patch({ nextRetryAt: null, hasRepeatedFailures: false });
  }
  await addSyncEvent(
    'sync',
    'completed',
    `reason=${reason} synced=${synced} perm=${permanentFailed} transient=${transientFailed}`,
  );
  return { synced, permanentFailed, transientFailed, skipped: false };
}

// --- triggers + lifecycle ---
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let focusUnlisten: (() => void) | null = null;
let engineStarted = false;

async function pollHealth(): Promise<void> {
  const wasOnline = useSyncStore.getState().online;
  const online = await healthPing();
  useSyncStore.getState().setOnline(online);
  if (!wasOnline && online) {
    void requestSync('reconnect');
    void maybeRefreshCatalog(true).catch(() => undefined);
  }
}

function onOsOnline(): void {
  void pollHealth(); // OS hint only; the health ping is authoritative.
}
function onOsOffline(): void {
  useSyncStore.getState().setOnline(false);
}
function onVisibility(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void pollHealth().then(() => void requestSync('focus'));
  }
}

async function installFocusListener(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    focusUnlisten = await getCurrentWindow().onFocusChanged(
      ({ payload: focused }: { payload: boolean }) => {
        if (focused) void pollHealth().then(() => void requestSync('focus'));
      },
    );
  } catch {
    // Not running inside Tauri (browser dev / vitest); window + visibility events cover focus.
  }
}

export function startSyncEngine(): void {
  if (engineStarted) return;
  engineStarted = true;
  periodicTimer = setInterval(() => {
    if (useSyncStore.getState().unsyncedCount > 0) void requestSync('periodic');
  }, PERIODIC_INTERVAL_MS);
  healthTimer = setInterval(() => void pollHealth(), HEALTH_INTERVAL_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOsOnline);
    window.addEventListener('offline', onOsOffline);
    window.addEventListener('visibilitychange', onVisibility);
  }
  void installFocusListener();
  void refreshCounts();
  // Contract §5: hydrate the stale-catalog chip after a cold start (e.g. a week offline) from
  // persisted meta, so pos-ui reads it from the store without forcing a fresh in-session pull.
  void getMeta('last_catalog_pull_at').then((last) => {
    if (last) useSyncStore.getState().patch({ catalogRefreshedAt: last });
  });
  void pollHealth();
}

export function stopSyncEngine(): void {
  if (!engineStarted) return;
  engineStarted = false;
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOsOnline);
    window.removeEventListener('offline', onOsOffline);
    window.removeEventListener('visibilitychange', onVisibility);
  }
  if (focusUnlisten) {
    focusUnlisten();
    focusUnlisten = null;
  }
}

export function __resetEngineForTests(): void {
  inFlight = null;
  rerunRequested = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  engineStarted = false;
}
