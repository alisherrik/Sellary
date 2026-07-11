import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetPendingSales,
  mockUpdateOutboxStatus,
  mockAddSyncEvent,
  mockRecoverSyncingSales,
  mockMarkOutboxSalesFailed,
  mockPushSales,
  mockCheckHealth,
} = vi.hoisted(() => ({
  mockGetPendingSales: vi.fn(),
  mockUpdateOutboxStatus: vi.fn(),
  mockAddSyncEvent: vi.fn(),
  mockRecoverSyncingSales: vi.fn(),
  mockMarkOutboxSalesFailed: vi.fn(),
  mockPushSales: vi.fn(),
  mockCheckHealth: vi.fn(),
}));

vi.mock('../db', () => ({
  getPendingSales: mockGetPendingSales,
  updateOutboxStatus: mockUpdateOutboxStatus,
  addSyncEvent: mockAddSyncEvent,
  recoverSyncingOutboxSales: mockRecoverSyncingSales,
  markOutboxSalesFailed: mockMarkOutboxSalesFailed,
}));

vi.mock('../api', () => ({
  pushSales: mockPushSales,
  checkHealth: mockCheckHealth,
}));

import { syncPendingSales } from '../sync-service';

function makeOutboxSale(overrides: Partial<{
  id: number;
  client_sale_id: string;
  status: string;
}> = {}) {
  return {
    id: overrides.id ?? 1,
    client_sale_id: overrides.client_sale_id ?? 'sale-1',
    idempotency_key: 'idem-1',
    status: overrides.status ?? 'pending',
    request_json: JSON.stringify({
      client_sale_id: overrides.client_sale_id ?? 'sale-1',
      idempotency_key: 'idem-1',
      created_at_client: '2025-01-01T00:00:00.000Z',
      payment_method: 'cash',
      card_type: null,
      discount_amount: 0,
      paid_amount: 100,
      change_amount: 0,
      notes: null,
      items: [],
    }),
    response_json: null,
    last_error: null,
    created_at_client: '2025-01-01T00:00:00.000Z',
    synced_at: null,
    retry_count: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkOutboxSalesFailed.mockResolvedValue(undefined);
  mockRecoverSyncingSales.mockResolvedValue(0);
  mockAddSyncEvent.mockResolvedValue(undefined);
  mockUpdateOutboxStatus.mockResolvedValue(undefined);
});

describe('syncPendingSales', () => {
  it('skips when server is unreachable', async () => {
    mockCheckHealth.mockResolvedValue(false);

    const result = await syncPendingSales();

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(mockCheckHealth).toHaveBeenCalled();
    expect(mockRecoverSyncingSales).not.toHaveBeenCalled();
    expect(mockGetPendingSales).not.toHaveBeenCalled();
    expect(mockAddSyncEvent).toHaveBeenCalledWith('sync', 'skipped', 'server unreachable');
  });

  it('recovers interrupted syncing sales before reading pending sales', async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([]);

    await syncPendingSales();

    expect(mockRecoverSyncingSales).toHaveBeenCalled();
    expect(mockGetPendingSales).toHaveBeenCalled();
    expect(mockAddSyncEvent).toHaveBeenCalledWith('sync', 'skipped', 'no sendable pending sales');
  });

  it('skips when there are no sendable pending sales', async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([]);

    const result = await syncPendingSales();

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(mockAddSyncEvent).toHaveBeenCalledWith('sync', 'skipped', 'no sendable pending sales');
  });

  it('marks sendable sales as syncing before push', async () => {
    const sale = makeOutboxSale({ id: 1, status: 'pending' });
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([sale]);
    mockPushSales.mockResolvedValue({ results: [{ client_sale_id: 'sale-1', status: 'synced', sale_id: 100, warnings: null, error: null }] });

    await syncPendingSales();

    expect(mockUpdateOutboxStatus).toHaveBeenCalledWith(1, 'syncing');
  });

  it('does not mark synced-status sales as syncing', async () => {
    const synced = makeOutboxSale({ id: 1, status: 'synced', client_sale_id: 'done' });
    const pending = makeOutboxSale({ id: 2, status: 'pending', client_sale_id: 'new' });
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([synced, pending]);
    mockPushSales.mockResolvedValue({ results: [{ client_sale_id: 'new', status: 'synced', sale_id: 100, warnings: null, error: null }] });

    await syncPendingSales();

    expect(mockUpdateOutboxStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateOutboxStatus).toHaveBeenCalledWith(2, 'syncing');
    expect(mockUpdateOutboxStatus).toHaveBeenCalledWith(2, 'synced', expect.any(String));
  });

  it('reports synced count for synced and duplicate results', async () => {
    const sale1 = makeOutboxSale({ id: 1, client_sale_id: 'sale-1', status: 'pending' });
    const sale2 = makeOutboxSale({ id: 2, client_sale_id: 'sale-2', status: 'failed' });
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([sale1, sale2]);
    mockPushSales.mockResolvedValue({
      results: [
        { client_sale_id: 'sale-1', status: 'synced', sale_id: 100, warnings: null, error: null },
        { client_sale_id: 'sale-2', status: 'duplicate', sale_id: null, warnings: null, error: null },
      ],
    });

    const result = await syncPendingSales();

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockUpdateOutboxStatus).toHaveBeenCalledWith(1, 'synced', expect.any(String));
    expect(mockUpdateOutboxStatus).toHaveBeenCalledWith(2, 'synced', expect.any(String));
  });

  it('reports failed count for error results', async () => {
    const sale = makeOutboxSale({ id: 1, client_sale_id: 'sale-1', status: 'pending' });
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([sale]);
    mockPushSales.mockResolvedValue({
      results: [
        { client_sale_id: 'sale-1', status: 'failed', sale_id: null, warnings: null, error: 'Server error' },
      ],
    });

    const result = await syncPendingSales();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockUpdateOutboxStatus).toHaveBeenCalledWith(1, 'failed', undefined, 'Server error');
  });

  it('marks sendable rows failed when pushSales throws', async () => {
    const sale1 = makeOutboxSale({ id: 1, client_sale_id: 'sale-1', status: 'pending' });
    const sale2 = makeOutboxSale({ id: 2, client_sale_id: 'sale-2', status: 'failed' });
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([sale1, sale2]);
    mockPushSales.mockRejectedValue(new Error('Network failure'));

    const result = await syncPendingSales();

    expect(mockMarkOutboxSalesFailed).toHaveBeenCalledWith([1, 2], 'Network failure');
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(2);
  });

  it('prevents concurrent sync operations', async () => {
    const sale = makeOutboxSale();
    mockCheckHealth.mockResolvedValue(true);
    mockRecoverSyncingSales.mockResolvedValue(0);
    mockGetPendingSales.mockResolvedValue([sale]);
    mockPushSales.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ results: [{ client_sale_id: 'sale-1', status: 'synced', sale_id: 100, warnings: null, error: null }] }), 50))
    );

    const [first, second] = await Promise.all([
      syncPendingSales(),
      syncPendingSales(),
    ]);

    expect(second).toEqual({ synced: 0, failed: 0 });
    expect(first).toEqual({ synced: 1, failed: 0 });
    expect(mockPushSales).toHaveBeenCalledTimes(1);
  });
});
