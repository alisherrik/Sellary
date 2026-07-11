import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGetSalesHistory, mockGetHistoryAggregates, mockGetSaleWithItems, mockUseSyncStore, mockRequestSync } = vi.hoisted(() => ({
  mockGetSalesHistory: vi.fn(),
  mockGetHistoryAggregates: vi.fn(),
  mockGetSaleWithItems: vi.fn(),
  mockUseSyncStore: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../lib/db', () => ({
  getSalesHistory: mockGetSalesHistory,
  getHistoryAggregates: mockGetHistoryAggregates,
  getSaleWithItems: mockGetSaleWithItems,
  getProductById: vi.fn(),
}));
vi.mock('../../lib/sync-store', () => ({ useSyncStore: mockUseSyncStore }));
vi.mock('../../lib/sync-engine', () => ({ requestSync: mockRequestSync }));

import { HistoryPage } from '../HistoryPage';

function oneSmallSale() {
  return [{
    id: 1, client_sale_id: 'abcdef123456', idempotency_key: 'i', receipt_no: 7,
    server_sale_id: null, subtotal: 300, discount_amount: 0, tax_amount: 0, total_amount: 300,
    paid_amount: 300, change_amount: 0, payment_method: 'cash', card_type: null, notes: null,
    cashier_user_id: null, cashier_username: null, sync_status: 'synced', error_kind: null,
    next_attempt_at: null, first_failed_at: null, last_error: null, retry_count: 0, stock_applied: 1,
    created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null, updated_at: '2026-07-10T09:00:00.000Z',
  }];
}

beforeEach(() => {
  mockUseSyncStore.mockReturnValue({
    online: true, unsyncedCount: 0, needsAttentionCount: 0, lastSyncedAt: null, isSyncing: false, syncNow: vi.fn(),
    hasRepeatedFailures: false,
  });
});

describe('HistoryPage', () => {
  it('shows KPIs from getHistoryAggregates, NOT from summing the loaded page', async () => {
    mockGetSalesHistory.mockResolvedValue(oneSmallSale());          // page sums to 300
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 1000000, count: 42, unsynced: 3, hourly: Array.from({ length: 24 }, () => 0) });

    render(<MemoryRouter><HistoryPage /></MemoryRouter>);

    // turnover from aggregates (1 000 000), not the page total (300)
    await waitFor(() => expect(screen.getByText((t) => t.replace(/\s/g, '') === '1000000UZS')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();  // Чеков from aggregates
    expect(screen.getByText('3')).toBeInTheDocument();   // Не синхронизировано from aggregates
    expect(screen.queryByText((t) => t.replace(/\s/g, '') === '300UZS' && t !== undefined)).toBeTruthy(); // row still shows its own total
  });

  it('calls both DAOs with the same active filter opts', async () => {
    mockGetSalesHistory.mockResolvedValue([]);
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) });
    render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    await waitFor(() => expect(mockGetHistoryAggregates).toHaveBeenCalled());
    const histOpts = mockGetSalesHistory.mock.calls[0][0];
    const aggOpts = mockGetHistoryAggregates.mock.calls[0][0];
    expect(aggOpts.syncFilter).toBe(histOpts.syncFilter);
    expect(aggOpts.syncFilter).toBe('all');
  });

  it('omits paymentMethod on the «Все» tab (never sends the literal "all") and maps dates to dateFrom/dateTo', async () => {
    mockGetSalesHistory.mockResolvedValue([]);
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) });
    render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    await waitFor(() => expect(mockGetSalesHistory).toHaveBeenCalled());
    const opts = mockGetSalesHistory.mock.calls[0][0];
    expect(opts.paymentMethod).toBeUndefined();      // NOT 'all'
    expect(opts).not.toHaveProperty('startDate');    // canonical field is dateFrom
    expect(opts).not.toHaveProperty('endDate');      // canonical field is dateTo
  });

  it('shows a non-blocking «повторные сбои» chip when sync-store.hasRepeatedFailures is true', async () => {
    mockUseSyncStore.mockReturnValue({
      online: true, unsyncedCount: 2, needsAttentionCount: 0, lastSyncedAt: null, isSyncing: false, syncNow: vi.fn(),
      hasRepeatedFailures: true,
    });
    mockGetSalesHistory.mockResolvedValue([]);
    mockGetHistoryAggregates.mockResolvedValue({ turnover: 0, count: 0, unsynced: 0, hourly: Array.from({ length: 24 }, () => 0) });
    render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    expect(await screen.findByText(/повторные сбои/i)).toBeInTheDocument();
  });
});
