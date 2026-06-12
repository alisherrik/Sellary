import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productsApi } from '@/lib/api';
import type { Product } from '@/lib/types';
import type { PurchaseOrderItemInput } from '@/features/purchase-orders/purchaseOrderForm';
import PurchaseOrderItemsTable from '../PurchaseOrderItemsTable';

vi.mock('@/lib/api', () => ({
  productsApi: { search: vi.fn() },
}));

const milk: Product = {
  id: 7,
  barcode: '460000000007',
  name: 'Молоко 3,2%',
  product_type: 'item',
  uom: 'шт',
  cost_price: '12.50',
  sell_price: '16',
  tax_percent: '0',
  stock_quantity: 10,
  min_stock_level: 2,
  is_active: true,
  created_at: '2026-06-01T00:00:00Z',
};

function Harness({ initialItems }: { initialItems: PurchaseOrderItemInput[] }) {
  const [items, setItems] = useState(initialItems);
  return (
    <PurchaseOrderItemsTable
      items={items}
      errors={{}}
      productsById={new Map([[milk.id, milk]])}
      onChange={setItems}
    />
  );
}

describe('PurchaseOrderItemsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(productsApi.search).mockResolvedValue({ data: [milk] } as never);
  });

  it('selects a product and seeds its current cost', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialItems={[
          { key: 'a', product_id: '', quantity_ordered: '1', unit_cost: '' },
        ]}
      />,
    );

    await user.type(screen.getByRole('combobox', { name: /товар/i }), 'Молоко');
    await user.click(await screen.findByRole('option', { name: /Молоко 3,2%/i }));

    expect(screen.getByDisplayValue('12.50')).toBeInTheDocument();
    expect(screen.getByText('шт')).toBeInTheDocument();
  });

  it('shows duplicate product feedback without adding a second copy', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialItems={[
          { key: 'a', product_id: '7', quantity_ordered: '1', unit_cost: '12.50' },
          { key: 'b', product_id: '', quantity_ordered: '1', unit_cost: '' },
        ]}
      />,
    );

    const comboboxes = screen.getAllByRole('combobox', { name: /товар/i });
    await user.type(comboboxes[1], 'Молоко');
    await user.click(await screen.findByRole('option', { name: /Молоко 3,2%/i }));

    expect(screen.getByText('Товар уже добавлен')).toBeInTheDocument();
  });

  it('updates the visible row subtotal when quantity changes', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialItems={[
          { key: 'a', product_id: '7', quantity_ordered: '2', unit_cost: '12.50' },
        ]}
      />,
    );

    const quantity = screen.getByLabelText('Количество, Молоко 3,2%');
    await user.clear(quantity);
    await user.type(quantity, '3');

    await waitFor(() => expect(screen.getByText(/37[,.]5/)).toBeInTheDocument());
  });

  it('restores selected product labels from the form state', () => {
    render(
      <PurchaseOrderItemsTable
        items={[
          {
            key: 'a',
            product_id: '7',
            product_name: 'Молоко 3,2%',
            product_uom: 'шт',
            quantity_ordered: '2',
            unit_cost: '12.50',
          },
        ]}
        errors={{}}
        productsById={new Map()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: /товар/i })).toHaveValue('Молоко 3,2%');
    expect(screen.getByText('шт')).toBeInTheDocument();
    expect(screen.queryByText('Уже добавлен')).not.toBeInTheDocument();
  });
});
