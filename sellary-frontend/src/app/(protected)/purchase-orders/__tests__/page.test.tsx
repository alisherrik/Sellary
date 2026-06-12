import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PurchaseOrder, Supplier } from '@/lib/types';
import PurchaseOrdersPage from '../page';

const northSupplier: Supplier = {
  id: 3,
  name: 'ООО Север Трейд',
  phone: '+992900000000',
  is_active: true,
  created_at: '2026-06-01T00:00:00Z',
};

const orders: PurchaseOrder[] = [
  {
    id: 1048,
    supplier_id: 3,
    supplier: { id: 3, name: northSupplier.name },
    order_date: '2026-06-12T00:00:00Z',
    status: 'partially_received',
    total_amount: '68420',
    is_active: true,
    created_at: '2026-06-12T00:00:00Z',
    items: [],
  },
  {
    id: 1049,
    supplier_id: 4,
    supplier: { id: 4, name: 'ООО Юг' },
    order_date: '2026-06-11T00:00:00Z',
    status: 'draft',
    total_amount: '1200',
    is_active: true,
    created_at: '2026-06-11T00:00:00Z',
    items: [],
  },
];

vi.mock('@/hooks/useQueries', () => ({
  usePurchaseOrders: vi.fn(() => ({ data: orders, isLoading: false })),
  useSuppliers: vi.fn(() => ({
    data: [northSupplier, { ...northSupplier, id: 4, name: 'ООО Юг' }],
    isLoading: false,
  })),
}));

vi.mock('@/lib/api', () => ({
  purchaseOrdersApi: {
    send: vi.fn(), cancel: vi.fn(), delete: vi.fn(), create: vi.fn(), update: vi.fn(),
  },
  suppliersApi: { getAll: vi.fn() },
  productsApi: { getAll: vi.fn() },
}));

describe('PurchaseOrdersPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes create action to the full-page editor', () => {
    render(<PurchaseOrdersPage />);

    expect(screen.getByRole('link', { name: 'Создать закупку' })).toHaveAttribute(
      'href',
      '/purchase-orders/new',
    );
  });

  it('filters loaded orders by supplier name and order number', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrdersPage />);
    const search = screen.getByRole('searchbox', { name: 'Поиск закупок' });

    await user.type(search, 'Север');
    expect(screen.getAllByText('ООО Север Трейд').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: '#1049' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '1049');
    expect(screen.getAllByText('#1049').length).toBeGreaterThan(0);
    expect(screen.queryByText('#1048')).not.toBeInTheDocument();
  });

  it('opens order detail from the primary row action', () => {
    render(<PurchaseOrdersPage />);

    expect(screen.getAllByRole('link', { name: 'Принять' })[0]).toHaveAttribute(
      'href',
      '/purchase-orders/1048',
    );
  });
});
