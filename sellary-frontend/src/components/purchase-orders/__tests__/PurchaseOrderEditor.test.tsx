import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PurchaseOrder, Supplier } from '@/lib/types';
import PurchaseOrderEditor from '../PurchaseOrderEditor';

vi.mock('@/lib/api', () => ({
  productsApi: { search: vi.fn() },
}));

const supplier: Supplier = {
  id: 3,
  name: 'ООО Север Трейд',
  phone: '+992900000000',
  is_active: true,
  created_at: '2026-06-01T00:00:00Z',
};

const purchaseOrder: PurchaseOrder = {
  id: 1048,
  supplier_id: supplier.id,
  supplier: { id: supplier.id, name: supplier.name },
  order_date: '2026-06-12T00:00:00Z',
  expected_delivery_date: '2026-06-20T00:00:00Z',
  status: 'draft',
  total_amount: '37.50',
  notes: 'До 12:00',
  is_active: true,
  created_at: '2026-06-12T00:00:00Z',
  items: [
    {
      id: 11,
      product_id: 7,
      quantity_ordered: 3,
      quantity_received: 0,
      unit_cost: '12.50',
      subtotal: '37.50',
      product: { id: 7, name: 'Молоко 3,2%', barcode: '460000000007', uom: 'шт' },
    },
  ],
};

describe('PurchaseOrderEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not leave supplier stage until a supplier is selected', async () => {
    const user = userEvent.setup();
    render(
      <PurchaseOrderEditor
        suppliers={[supplier]}
        onSave={vi.fn()}
        onSend={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

    expect(screen.getAllByText('Выберите поставщика')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Поставщик' })).toBeInTheDocument();
  });

  it('shows a live blue total in the sticky summary', () => {
    render(
      <PurchaseOrderEditor
        initialOrder={purchaseOrder}
        suppliers={[supplier]}
        onSave={vi.fn()}
        onSend={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('purchase-order-total')).toHaveTextContent(/37[,.]5/);
    expect(screen.getByTestId('purchase-order-total')).toHaveClass('text-blue-600');
  });

  it('saves before sending and returns the sent order', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(purchaseOrder);
    const sentOrder = { ...purchaseOrder, status: 'sent' as const };
    const onSend = vi.fn().mockResolvedValue(sentOrder);
    const onComplete = vi.fn();
    render(
      <PurchaseOrderEditor
        initialOrder={purchaseOrder}
        suppliers={[supplier]}
        onSave={onSave}
        onSend={onSend}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Проверка/ }));
    await user.click(screen.getByRole('button', { name: 'Отправить поставщику' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(purchaseOrder.id);
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      onSend.mock.invocationCallOrder[0],
    );
    expect(onComplete).toHaveBeenCalledWith(sentOrder);
  });

  it('keeps entered values after a failed save', async () => {
    const user = userEvent.setup();
    render(
      <PurchaseOrderEditor
        initialOrder={purchaseOrder}
        suppliers={[supplier]}
        onSave={vi.fn().mockRejectedValue(new Error('network'))}
        onSend={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Проверка/ }));
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));

    expect(screen.getAllByText('До 12:00').length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить закупку');
  });
});
