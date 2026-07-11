import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePurchaseOrder } from '@/hooks/useQueries';
import { purchaseOrdersApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { PurchaseOrder } from '@/lib/types';
import PurchaseOrderDetailPage from '../page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1048' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useQueries', () => ({
  usePurchaseOrder: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  purchaseOrdersApi: {
    previewVoid: vi.fn(),
    void: vi.fn(),
    previewVoidItem: vi.fn(),
    voidItem: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn(),
    receive: vi.fn(),
  },
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// A minimal AnnulmentDialog stub that surfaces the title and a confirm button
// so the item-void flow can be exercised without the real dialog internals.
vi.mock('@/components/transactions/AnnulmentDialog', () => ({
  default: ({ open, title, onConfirm }: any) =>
    open ? (
      <div>
        <span>{title}</span>
        <button type="button" onClick={() => onConfirm('Ошибочная позиция')}>
          stub-confirm
        </button>
      </div>
    ) : null,
}));

const makeOrder = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 1048,
  supplier_id: 3,
  supplier: { id: 3, name: 'ООО Север' },
  order_date: '2026-06-12T00:00:00Z',
  status: 'received',
  total_amount: '68420',
  is_active: true,
  created_at: '2026-06-12T00:00:00Z',
  items: [
    {
      id: 5001,
      product_id: 90,
      quantity_ordered: 6,
      quantity_received: 6,
      unit_cost: '5.00',
      subtotal: '30.00',
      product: { id: 90, name: 'Сахар 1кг' },
      is_voided: false,
    },
    {
      id: 5002,
      product_id: 91,
      quantity_ordered: 10,
      quantity_received: 10,
      unit_cost: '3.00',
      subtotal: '30.00',
      product: { id: 91, name: 'Мука 1кг' },
      is_voided: true,
      voided_at: '2026-06-13T00:00:00Z',
      void_reason: 'Пересорт',
    },
  ],
  ...overrides,
});

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PurchaseOrderDetailPage />
    </QueryClientProvider>,
  );
};

const asAdmin = (isAdmin: boolean) =>
  vi.mocked(useAuthStore).mockImplementation((selector: any) =>
    selector({ currentCompany: { id: 1, role: isAdmin ? 'admin' : 'manager' } }),
  );

describe('PurchaseOrderDetailPage line-level annulment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePurchaseOrder).mockReturnValue({
      data: makeOrder(),
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({}),
    } as any);
  });

  it('shows the row action for an active received line to an admin', () => {
    asAdmin(true);
    renderPage();
    expect(screen.getByRole('button', { name: 'Аннулировать позицию' })).toBeInTheDocument();
  });

  it('hides the row action from non-admins', () => {
    asAdmin(false);
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Аннулировать позицию' }),
    ).not.toBeInTheDocument();
  });

  it('renders an annulled badge and reason on a voided line with no action', () => {
    asAdmin(true);
    renderPage();
    expect(screen.getByText('Аннулирован')).toBeInTheDocument();
    expect(screen.getByText(/Причина: Пересорт/)).toBeInTheDocument();
    // Only the active line (5001) exposes the action; the voided line does not.
    expect(screen.getAllByRole('button', { name: 'Аннулировать позицию' })).toHaveLength(1);
  });

  it('previews then confirms an item void through the item-scoped endpoints', async () => {
    asAdmin(true);
    vi.mocked(purchaseOrdersApi.previewVoidItem).mockResolvedValue({
      data: { can_void: true, is_legacy: false, impacts: [], blockers: [] },
    } as any);
    vi.mocked(purchaseOrdersApi.voidItem).mockResolvedValue({ data: {} } as any);

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Аннулировать позицию' }));

    await waitFor(() =>
      expect(purchaseOrdersApi.previewVoidItem).toHaveBeenCalledWith(1048, 5001),
    );
    // The item dialog (stub) opens once the preview resolves.
    await user.click(await screen.findByRole('button', { name: 'stub-confirm' }));

    await waitFor(() =>
      expect(purchaseOrdersApi.voidItem).toHaveBeenCalledWith(1048, 5001, 'Ошибочная позиция'),
    );
  });
});
