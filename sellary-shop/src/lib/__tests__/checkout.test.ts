import { describe, it, expect } from 'vitest';
import { splitCartIntoOrders } from '../checkout';
import type { CartItem } from '../cart';

const META = {
  fulfillment_type: 'pickup' as const,
  delivery_address: null,
  contact_phone: '+992901234567',
  contact_name: 'Тест',
  notes: null,
};

describe('splitCartIntoOrders', () => {
  it('single-shop cart → 1 order', () => {
    const items: CartItem[] = [
      { productId: 1, name: 'Молоко', price: 12000, companyId: 1, quantity: 2 },
      { productId: 2, name: 'Хлеб', price: 5000, companyId: 1, quantity: 1 },
    ];
    const orders = splitCartIntoOrders(items, META);
    expect(orders).toHaveLength(1);
    expect(orders[0].company_id).toBe(1);
    expect(orders[0].items).toHaveLength(2);
  });

  it('multi-shop cart → N orders with correct company_id', () => {
    const items: CartItem[] = [
      { productId: 1, name: 'Молоко', price: 12000, companyId: 1, quantity: 2 },
      { productId: 2, name: 'Сок', price: 7000, companyId: 2, quantity: 3 },
      { productId: 3, name: 'Хлеб', price: 5000, companyId: 1, quantity: 1 },
    ];
    const orders = splitCartIntoOrders(items, META);
    expect(orders).toHaveLength(2);

    const order1 = orders.find(o => o.company_id === 1)!;
    const order2 = orders.find(o => o.company_id === 2)!;
    expect(order1).toBeDefined();
    expect(order2).toBeDefined();
    expect(order1.items).toHaveLength(2);
    expect(order2.items).toHaveLength(1);
  });

  it('maps price → unit_price and product_id correctly', () => {
    const items: CartItem[] = [
      { productId: 42, name: 'Тест', price: 9900, companyId: 5, quantity: 3 },
    ];
    const [order] = splitCartIntoOrders(items, META);
    expect(order.items[0]).toEqual({
      product_id: 42,
      quantity: 3,
      unit_price: 9900,
    });
  });

  it('all orders share the same checkout_group_id', () => {
    const items: CartItem[] = [
      { productId: 1, name: 'A', price: 1000, companyId: 1, quantity: 1 },
      { productId: 2, name: 'B', price: 2000, companyId: 2, quantity: 1 },
      { productId: 3, name: 'C', price: 3000, companyId: 3, quantity: 1 },
    ];
    const orders = splitCartIntoOrders(items, META);
    expect(orders).toHaveLength(3);
    const ids = orders.map(o => o.checkout_group_id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
  });

  it('passes fulfillment_type, contact fields, and notes through', () => {
    const items: CartItem[] = [
      { productId: 1, name: 'X', price: 500, companyId: 1, quantity: 1 },
    ];
    const meta = {
      fulfillment_type: 'delivery' as const,
      delivery_address: 'ул. Ленина, 1',
      contact_phone: '+99290000000',
      contact_name: 'Иван',
      notes: 'позвонить',
    };
    const [order] = splitCartIntoOrders(items, meta);
    expect(order.fulfillment_type).toBe('delivery');
    expect(order.delivery_address).toBe('ул. Ленина, 1');
    expect(order.contact_phone).toBe('+99290000000');
    expect(order.contact_name).toBe('Иван');
    expect(order.notes).toBe('позвонить');
  });

  it('returns empty array for empty items', () => {
    const orders = splitCartIntoOrders([], META);
    expect(orders).toHaveLength(0);
  });
});
