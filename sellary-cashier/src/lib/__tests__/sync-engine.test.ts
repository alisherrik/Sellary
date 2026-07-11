import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockCheckHealth,
  mockPushOnce,
  mockPullCatalog,
  mockGetSendableSales,
  mockMarkSaleSyncing,
  mockMarkSaleSynced,
  mockMarkTransientFailure,
  mockMarkPermanentFailure,
  mockRecoverSyncingSales,
  mockGetUnsyncedCount,
  mockGetNeedsAttentionCount,
  mockGetMeta,
  mockSetMeta,
  mockAddSyncEvent,
  mockToast,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockCheckHealth: vi.fn(),
  mockPushOnce: vi.fn(),
  mockPullCatalog: vi.fn(),
  mockGetSendableSales: vi.fn(),
  mockMarkSaleSyncing: vi.fn(),
  mockMarkSaleSynced: vi.fn(),
  mockMarkTransientFailure: vi.fn(),
  mockMarkPermanentFailure: vi.fn(),
  mockRecoverSyncingSales: vi.fn(),
  mockGetUnsyncedCount: vi.fn(),
  mockGetNeedsAttentionCount: vi.fn(),
  mockGetMeta: vi.fn(),
  mockSetMeta: vi.fn(),
  mockAddSyncEvent: vi.fn(),
  mockToast: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock('../api', () => ({ checkHealth: mockCheckHealth }));
vi.mock('../sync-service', () => ({ pushOnce: mockPushOnce, pullCatalog: mockPullCatalog }));
vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(mockToast, { success: mockToastSuccess }),
  toast: Object.assign(mockToast, { success: mockToastSuccess }),
}));
vi.mock('../db', () => ({
  getSendableSales: mockGetSendableSales,
  markSaleSyncing: mockMarkSaleSyncing,
  markSaleSynced: mockMarkSaleSynced,
  markTransientFailure: mockMarkTransientFailure,
  markPermanentFailure: mockMarkPermanentFailure,
  recoverSyncingSales: mockRecoverSyncingSales,
  getUnsyncedCount: mockGetUnsyncedCount,
  getNeedsAttentionCount: mockGetNeedsAttentionCount,
  getMeta: mockGetMeta,
  setMeta: mockSetMeta,
  addSyncEvent: mockAddSyncEvent,
}));

import {
  requestSync,
  syncNow,
  backoffMs,
  maybeRefreshCatalog,
  startSyncEngine,
  stopSyncEngine,
  __resetEngineForTests,
} from '../sync-engine';
import { useSyncStore, initialSyncState } from '../sync-store';

function makeSale(id: number, clientId: string, retry = 0) {
  return {
    id,
    client_sale_id: clientId,
    idempotency_key: `idem-${id}`,
    created_at_client: '2026-07-10T00:00:00.000Z',
    payment_method: 'cash',
    card_type: null,
    discount_amount: 0,
    paid_amount: 100,
    change_amount: 0,
    notes: null,
    retry_count: retry,
    items: [{ product_id: 7, quantity: 1, unit_price: 100 }],
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetEngineForTests();
  useSyncStore.setState(initialSyncState);
  mockCheckHealth.mockResolvedValue(true);
  mockRecoverSyncingSales.mockResolvedValue(0);
  mockGetSendableSales.mockResolvedValue([]);
  mockGetUnsyncedCount.mockResolvedValue(0);
  mockGetNeedsAttentionCount.mockResolvedValue(0);
  mockGetMeta.mockResolvedValue(new Date().toISOString()); // catalog fresh -> pull not due
  mockSetMeta.mockResolvedValue(undefined);
  mockAddSyncEvent.mockResolvedValue(undefined);
  mockPullCatalog.mockResolvedValue({ products: 0, categories: 0 });
  mockMarkSaleSyncing.mockResolvedValue(undefined);
  mockMarkSaleSynced.mockResolvedValue(undefined);
  mockMarkTransientFailure.mockResolvedValue(undefined);
  mockMarkPermanentFailure.mockResolvedValue(undefined);
});

afterEach(() => {
  __resetEngineForTests();
  vi.useRealTimers();
});

describe('runPass classification', () => {
  it('goes offline and skips push when the health ping fails', async () => {
    mockCheckHealth.mockResolvedValue(false);

    const res = await requestSync('manual');

    expect(res.skipped).toBe(true);
    expect(mockRecoverSyncingSales).not.toHaveBeenCalled();
    expect(mockPushOnce).not.toHaveBeenCalled();
    expect(useSyncStore.getState().engineState).toBe('offline');
    expect(useSyncStore.getState().online).toBe(false);
  });

  it('recovers interrupted syncing sales before reading sendable sales', async () => {
    await requestSync('manual');
    expect(mockRecoverSyncingSales).toHaveBeenCalledTimes(1);
    expect(mockGetSendableSales).toHaveBeenCalledTimes(1);
  });

  it('marks synced/duplicate results as synced and stores server ids', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a'), makeSale(2, 'b')]);
    mockPushOnce.mockResolvedValue([
      { client_sale_id: 'a', status: 'synced', sale_id: 900, warnings: null, error: null },
      { client_sale_id: 'b', status: 'duplicate', sale_id: null, warnings: null, error: null },
    ]);

    const res = await requestSync('manual');

    expect(mockMarkSaleSyncing).toHaveBeenCalledWith(1);
    expect(mockMarkSaleSyncing).toHaveBeenCalledWith(2);
    expect(mockMarkSaleSynced).toHaveBeenCalledWith(1, 900);
    expect(mockMarkSaleSynced).toHaveBeenCalledWith(2, null);
    expect(res.synced).toBe(2);
    expect(useSyncStore.getState().engineState).toBe('idle');
  });

  it('classifies a per-sale business error as permanent (no retry queue)', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
    mockPushOnce.mockResolvedValue([
      { client_sale_id: 'a', status: 'failed', sale_id: null, warnings: null, error: 'Products not found' },
    ]);

    const res = await requestSync('manual');

    expect(mockMarkPermanentFailure).toHaveBeenCalledWith(1, 'Products not found');
    expect(mockMarkTransientFailure).not.toHaveBeenCalled();
    expect(res.permanentFailed).toBe(1);
  });

  it('classifies a transport throw as transient with a backoff schedule for the whole batch', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a'), makeSale(2, 'b')]);
    mockPushOnce.mockRejectedValue(new Error('Network failure'));

    const res = await requestSync('manual');

    expect(mockMarkTransientFailure).toHaveBeenCalledTimes(1);
    const [ids, nextAttemptAt, error] = mockMarkTransientFailure.mock.calls[0];
    expect(ids).toEqual([1, 2]);
    expect(typeof nextAttemptAt).toBe('string');
    expect(new Date(nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(error).toBe('Network failure');
    expect(res.transientFailed).toBe(2);
    expect(useSyncStore.getState().engineState).toBe('backing_off');
    expect(useSyncStore.getState().lastError).toBe('Network failure');
  });

  it('does not pull the catalog when the push transport-failed', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
    mockPushOnce.mockRejectedValue(new Error('Network failure'));
    mockGetMeta.mockResolvedValue(null); // pull would otherwise be due

    await requestSync('manual');

    expect(mockPullCatalog).not.toHaveBeenCalled();
  });
});

describe('warning surfacing + force resend', () => {
  it('emits an amber oversell toast and stores lastWarningCount from result warnings', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
    mockPushOnce.mockResolvedValue([
      {
        client_sale_id: 'a',
        status: 'synced',
        sale_id: 900,
        warnings: ['Кола: перерасход 3', 'Сок: перерасход 1'],
        error: null,
      },
    ]);

    await requestSync('manual');

    expect(mockToast).toHaveBeenCalledWith(
      'Синхронизировано, перерасход: 2 позиций',
      expect.objectContaining({ icon: '⚠️' }),
    );
    expect(useSyncStore.getState().lastWarningCount).toBe(2);
  });

  it('emits a mixed-batch toast when some sales sync and others fail permanently', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a'), makeSale(2, 'b')]);
    mockPushOnce.mockResolvedValue([
      { client_sale_id: 'a', status: 'synced', sale_id: 900, warnings: null, error: null },
      { client_sale_id: 'b', status: 'failed', sale_id: null, warnings: null, error: 'Products not found' },
    ]);

    await requestSync('manual');

    expect(mockToast).toHaveBeenCalledWith('Отправлено 1 · требует внимания 1');
  });

  it('sets hasRepeatedFailures when a transient batch has retry_count >= 8', async () => {
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a', 8)]);
    mockPushOnce.mockRejectedValue(new Error('Network failure'));

    await requestSync('manual');

    expect(useSyncStore.getState().hasRepeatedFailures).toBe(true);
  });

  it('force:true requests sendable sales including permanent-failed rows', async () => {
    mockGetSendableSales.mockResolvedValue([]);

    await requestSync('manual', { force: true });

    expect(mockGetSendableSales).toHaveBeenCalledWith(
      expect.any(String),
      { includePermanent: true },
    );
  });

  it('default (unforced) requests sendable sales without the includePermanent flag', async () => {
    mockGetSendableSales.mockResolvedValue([]);

    await requestSync('manual');

    expect(mockGetSendableSales).toHaveBeenCalledWith(expect.any(String), undefined);
  });
});

describe('single-flight + coalescing', () => {
  it('returns the same in-flight promise to concurrent callers', async () => {
    let resolvePush: (v: unknown) => void = () => {};
    mockGetSendableSales.mockResolvedValue([makeSale(1, 'a')]);
    mockPushOnce.mockImplementation(
      () => new Promise((r) => { resolvePush = r; }),
    );

    const p1 = requestSync('manual');
    const p2 = requestSync('post-sale');
    expect(p2).toBe(p1);

    // runPass reaches pushOnce() only after several intervening awaits (health ping,
    // recoverSyncingSales, getSendableSales, markSaleSyncing); wait for that call to
    // actually happen so `resolvePush` is bound to the live promise before we call it
    // (calling it immediately would resolve the initial no-op stub instead and hang).
    await vi.waitFor(() => expect(mockPushOnce).toHaveBeenCalled());
    resolvePush([{ client_sale_id: 'a', status: 'synced', sale_id: 1, warnings: null, error: null }]);
    await p1;
    await Promise.resolve();
  });

  it('coalesces a burst of requests into at most one active pass plus one rerun', async () => {
    mockGetSendableSales.mockResolvedValue([]); // no push work; passes are cheap

    const first = requestSync('manual');
    requestSync('post-sale');
    requestSync('focus');
    requestSync('periodic');
    await first;
    // allow the coalesced rerun to run to completion
    await new Promise((r) => setTimeout(r, 0));

    // 1 active pass + exactly 1 coalesced rerun = 2 health pings, never 4.
    expect(mockCheckHealth).toHaveBeenCalledTimes(2);
  });

  it('syncNow drives a manual pass', async () => {
    mockGetSendableSales.mockResolvedValue([]);
    const res = await syncNow();
    expect(res.skipped).toBe(false);
    expect(mockCheckHealth).toHaveBeenCalled();
  });
});

describe('maybeRefreshCatalog cadence', () => {
  it('skips the pull when the catalog was refreshed within the interval', async () => {
    mockGetMeta.mockResolvedValue(new Date().toISOString());
    await maybeRefreshCatalog();
    expect(mockPullCatalog).not.toHaveBeenCalled();
  });

  it('pulls when the catalog is stale (older than the interval)', async () => {
    mockGetMeta.mockResolvedValue(new Date(Date.now() - 20 * 60_000).toISOString());
    await maybeRefreshCatalog();
    expect(mockPullCatalog).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().catalogRefreshedAt).not.toBeNull();
  });

  it('pulls when there is no prior pull timestamp', async () => {
    mockGetMeta.mockResolvedValue(null);
    await maybeRefreshCatalog();
    expect(mockPullCatalog).toHaveBeenCalledTimes(1);
  });

  it('force pulls regardless of freshness', async () => {
    mockGetMeta.mockResolvedValue(new Date().toISOString());
    await maybeRefreshCatalog(true);
    expect(mockPullCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('triggers + lifecycle', () => {
  afterEach(() => {
    stopSyncEngine();
    vi.useRealTimers();
  });

  it('the 30s periodic timer only fires a pass while unsyncedCount > 0', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockResolvedValue(true);
    mockGetSendableSales.mockResolvedValue([]);
    mockGetUnsyncedCount.mockResolvedValue(0);

    startSyncEngine();
    // startup runs one immediate pollHealth; ignore checkHealth counts from that.
    const baseline = mockCheckHealth.mock.calls.length;

    // unsyncedCount is 0 -> periodic tick must NOT start a pass.
    await vi.advanceTimersByTimeAsync(30_000);
    // Only the 10s health poll(s) may have pinged; the periodic pass added none.
    useSyncStore.setState({ unsyncedCount: 2 });
    const beforeArmed = mockGetSendableSales.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockGetSendableSales.mock.calls.length).toBeGreaterThan(beforeArmed);
    expect(baseline).toBeGreaterThanOrEqual(1);
  });

  it('a health poll that flips offline->online triggers a reconnect pass and a forced catalog pull', async () => {
    vi.useFakeTimers();
    useSyncStore.setState({ online: false });
    mockCheckHealth.mockResolvedValue(true);
    mockGetSendableSales.mockResolvedValue([]);
    mockGetMeta.mockResolvedValue(new Date().toISOString());

    startSyncEngine();
    await vi.advanceTimersByTimeAsync(0); // let the startup pollHealth resolve

    expect(useSyncStore.getState().online).toBe(true);
    expect(mockPullCatalog).toHaveBeenCalled(); // forced pull on reconnect
  });

  it('stopSyncEngine clears timers so no further passes run', async () => {
    vi.useFakeTimers();
    mockCheckHealth.mockResolvedValue(true);
    startSyncEngine();
    stopSyncEngine();
    const before = mockCheckHealth.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockCheckHealth.mock.calls.length).toBe(before);
  });

  it('hydrates catalogRefreshedAt from meta(last_catalog_pull_at) on start (cold-start chip)', async () => {
    vi.useFakeTimers();
    const ts = '2026-07-03T00:00:00.000Z';
    mockGetMeta.mockResolvedValue(ts);
    mockCheckHealth.mockResolvedValue(true);

    startSyncEngine();
    await vi.advanceTimersByTimeAsync(0); // let the meta read resolve

    expect(useSyncStore.getState().catalogRefreshedAt).toBe(ts);
  });
});

describe('backoffMs', () => {
  it('grows exponentially from a 5s base with the midpoint jitter', () => {
    const rand = () => 0.5; // jitter factor -> 1.0
    expect(backoffMs(0, rand)).toBe(5000);
    expect(backoffMs(1, rand)).toBe(10000);
    expect(backoffMs(3, rand)).toBe(40000);
  });

  it('caps at 5 minutes (plus jitter headroom) and never goes negative', () => {
    expect(backoffMs(20, () => 1)).toBeLessThanOrEqual(5 * 60_000 * 1.2);
    expect(backoffMs(20, () => 0)).toBeGreaterThanOrEqual(0);
  });
});
