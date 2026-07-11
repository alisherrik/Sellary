import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGetSalesHistory, mockAcknowledgeSale, mockRequestSync } = vi.hoisted(() => ({
  mockGetSalesHistory: vi.fn(),
  mockAcknowledgeSale: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getSalesHistory: mockGetSalesHistory,
  acknowledgeSale: mockAcknowledgeSale,
}));
vi.mock('../../../lib/sync-engine', () => ({ requestSync: mockRequestSync }));

import { NeedsAttentionList } from '../NeedsAttentionList';

function permanentSale(over = {}) {
  return {
    id: 5, client_sale_id: 'zzz', idempotency_key: 'i', receipt_no: 99, server_sale_id: null,
    subtotal: 200, discount_amount: 0, tax_amount: 0, total_amount: 200, paid_amount: 200, change_amount: 0,
    payment_method: 'cash', card_type: null, notes: null, cashier_user_id: null, cashier_username: null,
    sync_status: 'failed', error_kind: 'permanent', next_attempt_at: null, first_failed_at: null,
    last_error: 'Products not found', retry_count: 4, stock_applied: 1,
    created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null, updated_at: '2026-07-10T09:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  mockAcknowledgeSale.mockResolvedValue(undefined);
  mockRequestSync.mockResolvedValue(undefined);
});

describe('NeedsAttentionList', () => {
  it('renders each needs-attention sale with its error', async () => {
    mockGetSalesHistory.mockResolvedValue([permanentSale()]);
    render(<NeedsAttentionList />);
    expect(await screen.findByText('Products not found')).toBeInTheDocument();
    expect(mockGetSalesHistory).toHaveBeenCalledWith(expect.objectContaining({ syncFilter: 'attention' }));
  });
  it('resend triggers a forced sync', async () => {
    mockGetSalesHistory.mockResolvedValue([permanentSale()]);
    render(<NeedsAttentionList />);
    fireEvent.click(await screen.findByRole('button', { name: /Повторить отправку/ }));
    await waitFor(() => expect(mockRequestSync).toHaveBeenCalledWith('manual', { force: true }));
  });
  it('acknowledge calls acknowledgeSale with the id and never deletes', async () => {
    mockGetSalesHistory.mockResolvedValue([permanentSale()]);
    render(<NeedsAttentionList />);
    fireEvent.click(await screen.findByRole('button', { name: /Отметить решённым/ }));
    await waitFor(() => expect(mockAcknowledgeSale).toHaveBeenCalledWith(5));
    expect(screen.queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
  });
  it('shows an all-clear state when empty', async () => {
    mockGetSalesHistory.mockResolvedValue([]);
    render(<NeedsAttentionList />);
    expect(await screen.findByText(/Все продажи синхронизированы/)).toBeInTheDocument();
  });
});
