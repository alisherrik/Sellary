import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => selector({ currentCompany: { id: 1, role: 'admin' } }),
}));

vi.mock('@/lib/api', () => ({
  shiftsApi: { getCurrent: vi.fn(), open: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ShiftGateBanner } from '../ShiftGate';
import { shiftsApi } from '@/lib/api';

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShiftGateBanner />
    </QueryClientProvider>,
  );
}

const openShift = {
  id: 1, shift_number: 1, status: 'open', opened_at: '2026-07-16T08:00:00Z',
  opened_by_user_id: 1, opening_cash: '0.00', closed_at: null, closed_by_user_id: null,
  counted_cash: null, expected_cash: null, discrepancy: null, notes: null,
  totals: {
    cash_sales: '0.00', card_sales: '0.00', card_by_type: {}, mobile_sales: '0.00',
    credit_sales: '0.00', debt_payments_by_method: {}, refunds_by_method: {},
    sales_count: 0, expected_cash: '0.00',
  },
};

describe('ShiftGateBanner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the open-shift prompt when the server reports no open shift', async () => {
    vi.mocked(shiftsApi.getCurrent).mockResolvedValue({ data: null } as never);
    renderBanner();
    expect(await screen.findByText('Смена не открыта')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /открыть смену/i })).toBeInTheDocument();
  });

  it('stays hidden while a shift is open', async () => {
    vi.mocked(shiftsApi.getCurrent).mockResolvedValue({ data: openShift } as never);
    renderBanner();
    // Give the query a tick; the banner must never appear.
    await waitFor(() => expect(shiftsApi.getCurrent).toHaveBeenCalled());
    expect(screen.queryByText('Смена не открыта')).not.toBeInTheDocument();
  });
});
