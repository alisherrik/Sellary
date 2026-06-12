import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PurchaseOrder } from '@/lib/types';
import PurchaseOrderReceiveStage from '../PurchaseOrderReceiveStage';

const order: PurchaseOrder = {
  id: 1048,
  supplier_id: 3,
  supplier: { id: 3, name: 'ООО Север Трейд' },
  order_date: '2026-06-12T00:00:00Z',
  status: 'partially_received',
  total_amount: '125',
  is_active: true,
  created_at: '2026-06-12T00:00:00Z',
  items: [
    {
      id: 11,
      product_id: 7,
      quantity_ordered: 10,
      quantity_received: 4,
      unit_cost: '12.50',
      subtotal: '125',
      product: { id: 7, name: 'Молоко 3,2%', uom: 'шт' },
    },
    {
      id: 12,
      product_id: 8,
      quantity_ordered: 3,
      quantity_received: 3,
      unit_cost: '2',
      subtotal: '6',
      product: { id: 8, name: 'Пакет', uom: 'шт' },
    },
  ],
};

describe('PurchaseOrderReceiveStage', () => {
  it('starts every receive quantity at zero', () => {
    render(<PurchaseOrderReceiveStage order={order} onReceive={vi.fn()} />);

    expect(screen.getByLabelText('Принять сейчас, Молоко 3,2%')).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Подтвердить приёмку' })).toBeDisabled();
  });

  it('fills only remaining quantities', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderReceiveStage order={order} onReceive={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Принять всё оставшееся' }));

    expect(screen.getByLabelText('Принять сейчас, Молоко 3,2%')).toHaveValue(6);
    expect(screen.getByText('Будет принято: 6 ед.')).toBeInTheDocument();
  });

  it('blocks values above remaining and submits positive rows only', async () => {
    const user = userEvent.setup();
    const onReceive = vi.fn().mockResolvedValue(order);
    render(<PurchaseOrderReceiveStage order={order} onReceive={onReceive} />);
    const input = screen.getByLabelText('Принять сейчас, Молоко 3,2%');

    await user.clear(input);
    await user.type(input, '7');
    expect(screen.getByText('Максимум: 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подтвердить приёмку' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, '4');
    await user.click(screen.getByRole('button', { name: 'Подтвердить приёмку' }));

    expect(onReceive).toHaveBeenCalledWith({
      items: [{ item_id: 11, quantity_to_receive: 4 }],
    });
  });
});
