import { checkHealth } from './api';
import { pushOnce, pullCatalog, pushCustomersOnce, pushPaymentsOnce } from './sync-service';
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
  getSendableCustomers,
  markCustomerSyncing,
  applyCustomerIdMap,
  markCustomerPermanentFailure,
  markCustomerTransientFailure,
  recoverSyncingCustomers,
  getSendablePayments,
  markPaymentSyncing,
  applyPaymentResults,
  markPaymentPermanentFailure,
  markPaymentTransientFailure,
  recoverSyncingPayments,
  getUnsyncedCreditCount,
  getNeedsAttentionCreditCount,
} from './db';
import type { LocalCustomer, LocalCustomerPayment } from './db';
import type { SyncCustomerResult, SyncPaymentResult } from './api';
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
  const [salesUnsynced, salesAttention, creditUnsynced, creditAttention] = await Promise.all([
    getUnsyncedCount(),
    getNeedsAttentionCount(),
    getUnsyncedCreditCount(),
    getNeedsAttentionCreditCount(),
  ]);
  useSyncStore.getState().patch({
    unsyncedCount: salesUnsynced + creditUnsynced,
    needsAttentionCount: salesAttention + creditAttention,
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

// --- generic credit-queue push (customers + payments share the reconcile/backoff shape) ---
interface CreditQueueOutcome {
  synced: number;
  permanentFailed: number;
  transientFailed: number;
  warnings: number;
  transportError: string | null;
  maxRetry: number;
}

const EMPTY_QUEUE_OUTCOME: CreditQueueOutcome = {
  synced: 0,
  permanentFailed: 0,
  transientFailed: 0,
  warnings: 0,
  transportError: null,
  maxRetry: 0,
};

interface CreditQueueOps<TItem, TResult> {
  getSendable: (nowIso: string, opts?: { includePermanent?: boolean }) => Promise<TItem[]>;
  clientKey: (item: TItem) => string;
  retryCount: (item: TItem) => number;
  markSyncing: (clientKey: string) => Promise<void>;
  push: (items: TItem[]) => Promise<TResult[]>;
  apply: (results: TResult[]) => Promise<void>; // synced/duplicate ONLY (contract §C-6)
  resultKey: (result: TResult) => string;
  isSynced: (result: TResult) => boolean;
  warningsOf: (result: TResult) => number;
  errorOf: (result: TResult) => string;
  markPermanent: (clientKey: string, error: string) => Promise<void>; // per failed business result
  markTransient: (clientKeys: string[], nextAttemptAt: string, error: string) => Promise<void>;
}

// Mirrors the Phase-1 sales worker: mark syncing, push, then the ENGINE reconciles results —
// apply() writes synced/duplicate rows; failed (business) results are marked permanent here;
// a transport throw / non-2xx backs off the whole batch (contract §C-6). apply() never marks failed.
async function runCreditQueue<TItem, TResult>(
  ops: CreditQueueOps<TItem, TResult>,
  now: string,
  force: boolean,
): Promise<CreditQueueOutcome> {
  const sendable = await ops.getSendable(now, force ? { includePermanent: true } : undefined);
  if (sendable.length === 0) return EMPTY_QUEUE_OUTCOME;
  for (const item of sendable) {
    await ops.markSyncing(ops.clientKey(item));
  }
  try {
    const results = await ops.push(sendable);
    await ops.apply(results); // synced/duplicate ONLY — engine owns failed marking below
    let synced = 0;
    let permanentFailed = 0;
    let warnings = 0;
    for (const r of results) {
      warnings += ops.warningsOf(r);
      if (ops.isSynced(r)) {
        synced++;
      } else {
        await ops.markPermanent(ops.resultKey(r), ops.errorOf(r)); // status==='failed' business error
        permanentFailed++;
      }
    }
    return { synced, permanentFailed, transientFailed: 0, warnings, transportError: null, maxRetry: 0 };
  } catch (e) {
    const transportError = getErrorMessage(e, 'Sync error');
    const keys = sendable.map(ops.clientKey);
    const maxRetry = sendable.reduce((m, s) => Math.max(m, ops.retryCount(s)), 0);
    const next = new Date(Date.now() + backoffMs(maxRetry)).toISOString();
    await ops.markTransient(keys, next, transportError); // transport throw / non-2xx: backoff batch
    return { synced: 0, permanentFailed: 0, transientFailed: keys.length, warnings: 0, transportError, maxRetry };
  }
}

const customerOps: CreditQueueOps<LocalCustomer, SyncCustomerResult> = {
  getSendable: getSendableCustomers,
  clientKey: (c) => c.client_customer_id,
  retryCount: (c) => c.retry_count ?? 0,
  markSyncing: markCustomerSyncing,
  push: pushCustomersOnce,
  apply: applyCustomerIdMap, // synced/duplicate ONLY
  resultKey: (r) => r.client_customer_id,
  isSynced: (r) => r.status === 'synced' || r.status === 'duplicate',
  warningsOf: () => 0, // customers carry no warnings
  errorOf: (r) => r.error || 'Unknown error',
  markPermanent: markCustomerPermanentFailure,
  markTransient: markCustomerTransientFailure,
};

const paymentOps: CreditQueueOps<LocalCustomerPayment, SyncPaymentResult> = {
  getSendable: getSendablePayments,
  clientKey: (p) => p.client_payment_id,
  retryCount: (p) => p.retry_count ?? 0,
  markSyncing: markPaymentSyncing,
  push: pushPaymentsOnce,
  apply: applyPaymentResults, // synced/duplicate ONLY
  resultKey: (r) => r.client_payment_id,
  isSynced: (r) => r.status === 'synced' || r.status === 'duplicate',
  warningsOf: (r) => r.warnings?.length ?? 0,
  errorOf: (r) => r.error || 'Unknown error',
  markPermanent: markPaymentPermanentFailure,
  markTransient: markPaymentTransientFailure,
};

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

  const now = nowIso();
  await recoverSyncingSales(now);
  await recoverSyncingCustomers(now);
  await recoverSyncingPayments(now);

  let synced = 0;
  let permanentFailed = 0;
  let transientFailed = 0;
  let oversellWarnings = 0;
  let overpaymentWarnings = 0;
  let transportError: string | null = null;
  let maxRetry = 0;

  // 1) Customers first: applyCustomerIdMap fills customers.server_id so credit sales + payments
  //    (which reference client_customer_id) resolve server-side in this same pass (spec §4).
  const cust = await runCreditQueue(customerOps, now, force);
  synced += cust.synced;
  permanentFailed += cust.permanentFailed;
  transientFailed += cust.transientFailed;
  if (cust.transportError) {
    transportError = cust.transportError;
    maxRetry = Math.max(maxRetry, cust.maxRetry);
  }

  // 2) Sales (cash/card/mobile + credit). Skipped only when the customer push transport-failed:
  //    the network is down and credit sales could not resolve their customer yet.
  if (!transportError) {
    // force ⇒ also re-send permanent-failed rows (contract §4.2, the History "Повторить" path).
    const sendable = await getSendableSales(now, force ? { includePermanent: true } : undefined);
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
          oversellWarnings += r.warnings?.length ?? 0; // oversell positions the server tolerated
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
        const salesMaxRetry = sendable.reduce((m, s) => Math.max(m, s.retry_count ?? 0), 0);
        const next = new Date(Date.now() + backoffMs(salesMaxRetry)).toISOString();
        await markTransientFailure(ids, next, transportError);
        transientFailed += ids.length;
        maxRetry = Math.max(maxRetry, salesMaxRetry);
      }
    }
  }

  // 3) Debt payments last: they also reference customers by client_customer_id, and the server
  //    caps each to the current balance (overpayment warning surfaced below).
  if (!transportError) {
    const pay = await runCreditQueue(paymentOps, now, force);
    synced += pay.synced;
    permanentFailed += pay.permanentFailed;
    transientFailed += pay.transientFailed;
    overpaymentWarnings += pay.warnings;
    if (pay.transportError) {
      transportError = pay.transportError;
      maxRetry = Math.max(maxRetry, pay.maxRetry);
    }
  }

  // 4) Pull catalog + customers only if nothing transport-failed (server now reflects the pushes).
  if (!transportError) {
    try {
      await maybeRefreshCatalog();
    } catch (e) {
      await addSyncEvent('catalog', 'error', getErrorMessage(e, 'Catalog refresh failed'));
    }
  }

  await refreshCounts();

  const warningCount = oversellWarnings + overpaymentWarnings;
  store.patch({ lastWarningCount: warningCount });

  // Spec §5.4 surfacing: oversell (sales) + overpayment (payments) get user-visible amber toasts.
  if (oversellWarnings > 0) {
    toast(`Синхронизировано, перерасход: ${oversellWarnings} позиций`, {
      icon: '⚠️',
      style: { background: '#f59e0b', color: '#111827' },
    });
  }
  if (overpaymentWarnings > 0) {
    toast(`Оплата превышает долг: ${overpaymentWarnings}`, {
      icon: '⚠️',
      style: { background: '#f59e0b', color: '#111827' },
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
    const next = new Date(Date.now() + backoffMs(maxRetry)).toISOString();
    store.patch({
      lastError: transportError,
      nextRetryAt: next,
      hasRepeatedFailures: maxRetry >= REPEATED_FAILURE_THRESHOLD, // spec §4.7 chip
    });
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
  if (!engineStarted) return; // stopSyncEngine ran while this poll was in flight; no-op.
  useSyncStore.getState().setOnline(online);
  if (!wasOnline && online) {
    // Awaited (not fire-and-forget) so callers that sequence work after a poll — notably the
    // startup hydration in startSyncEngine — observe the reconnect pass and forced catalog pull
    // as fully settled, instead of racing them.
    await requestSync('reconnect');
    await maybeRefreshCatalog(true).catch(() => undefined);
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
    void pollHealth().then(() => {
      if (engineStarted) void requestSync('focus');
    });
  }
}

async function installFocusListener(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    focusUnlisten = await getCurrentWindow().onFocusChanged(
      ({ payload: focused }: { payload: boolean }) => {
        if (focused) {
          void pollHealth().then(() => {
            if (engineStarted) void requestSync('focus');
          });
        }
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
  // Sequenced to run AFTER the startup health poll (and the reconnect pass/forced catalog pull
  // it may trigger) has fully settled, so the persisted "last real pull" timestamp is always the
  // final write — it is never clobbered by an in-flight cold-start reconnect that hasn't pulled
  // yet, and it correctly overrides a reconnect pull that already ran.
  void pollHealth().then(() =>
    getMeta('last_catalog_pull_at').then((last) => {
      if (!engineStarted) return; // stopSyncEngine ran while this was in flight; no-op.
      if (last) useSyncStore.getState().patch({ catalogRefreshedAt: last });
    }),
  );
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
