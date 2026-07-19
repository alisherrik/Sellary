import { describe, it, expect } from 'vitest';
import type { Order, OrderStatus, FulfillmentType } from '@/lib/types';

describe('Order types', () => {
  it('accepts a well-formed order literal', () => {
    const status: OrderStatus = 'pending';
    const fulfillment: FulfillmentType = 'delivery';
    const order: Order = {
      id: 1,
      company_id: 1,
      order_number: 42,
      status,
      fulfillment_type: fulfillment,
      delivery_address: 'ул. Рудаки 10',
      contact_phone: '+992900001122',
      contact_name: 'Фируз',
      subtotal: '150.00',
      total_amount: '150.00',
      notes: null,
      sale_id: null,
      checkout_group_id: null,
      created_at: '2026-07-19T00:00:00Z',
      updated_at: '2026-07-19T00:00:00Z',
      items: [
        { id: 1, product_id: 5, product_name: 'Хлеб', unit_price: '3.00', quantity: '2', line_total: '6.00' },
      ],
    };
    expect(order.items[0].product_name).toBe('Хлеб');
    expect(order.status).toBe('pending');
  });
});
