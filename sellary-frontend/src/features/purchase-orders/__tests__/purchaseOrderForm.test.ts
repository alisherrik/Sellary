import { describe, expect, it } from 'vitest';

import {
  buildPurchaseOrderPayload,
  calculateOrderTotal,
  createEmptyPurchaseOrderForm,
  getDuplicateProductIds,
  getRemainingQuantity,
  hasPurchaseOrderErrors,
  validatePurchaseOrderForm,
  validateReceiveQuantity,
} from '../purchaseOrderForm';

describe('purchaseOrderForm', () => {
  it('creates one editable empty row', () => {
    const form = createEmptyPurchaseOrderForm();

    expect(form.items).toHaveLength(1);
    expect(form.items[0]).toMatchObject({
      product_id: '',
      quantity_ordered: '1',
      unit_cost: '',
    });
  });

  it('calculates a decimal order total from valid rows', () => {
    expect(
      calculateOrderTotal([
        { key: 'a', product_id: '1', quantity_ordered: '2', unit_cost: '12.50' },
        { key: 'b', product_id: '2', quantity_ordered: '3', unit_cost: '5' },
      ]),
    ).toBe(40);
  });

  it('reports duplicated selected products', () => {
    expect(
      getDuplicateProductIds([
        { key: 'a', product_id: '7', quantity_ordered: '1', unit_cost: '2' },
        { key: 'b', product_id: '7', quantity_ordered: '2', unit_cost: '2' },
      ]),
    ).toEqual(new Set([7]));
  });

  it('blocks review when supplier or rows are invalid', () => {
    const errors = validatePurchaseOrderForm({
      supplier_id: '',
      expected_delivery_date: '',
      notes: '',
      items: [{ key: 'a', product_id: '', quantity_ordered: '0', unit_cost: '-1' }],
    });

    expect(errors.supplier_id).toBeTruthy();
    expect(errors.items.a.product_id).toBeTruthy();
    expect(errors.items.a.quantity_ordered).toBeTruthy();
    expect(errors.items.a.unit_cost).toBeTruthy();
    expect(hasPurchaseOrderErrors(errors)).toBe(true);
  });

  it('maps string inputs to the existing backend payload', () => {
    expect(
      buildPurchaseOrderPayload({
        supplier_id: '3',
        expected_delivery_date: '2026-06-20',
        notes: 'До 12:00',
        items: [
          { key: 'a', product_id: '9', quantity_ordered: '4.5', unit_cost: '18.25' },
        ],
      }),
    ).toEqual({
      supplier_id: 3,
      expected_delivery_date: '2026-06-20T00:00:00.000Z',
      notes: 'До 12:00',
      items: [{ product_id: 9, quantity_ordered: 4.5, unit_cost: 18.25 }],
    });
  });

  it('validates receiving against the remaining amount', () => {
    expect(getRemainingQuantity({ quantity_ordered: 10, quantity_received: 4 })).toBe(6);
    expect(validateReceiveQuantity(-1, 6)).toBe('Количество не может быть отрицательным');
    expect(validateReceiveQuantity(7, 6)).toBe('Максимум: 6');
    expect(validateReceiveQuantity(6, 6)).toBeNull();
  });
});
