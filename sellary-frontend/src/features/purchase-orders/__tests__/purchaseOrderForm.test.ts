import { describe, expect, it } from 'vitest';

import {
  buildPurchaseOrderPayload,
  calculateOrderedQuantity,
  calculateOrderTotal,
  createEmptyPurchaseOrderForm,
  deriveLineTotal,
  deriveUnitCostFromTotal,
  getDuplicateProductIds,
  getRemainingQuantity,
  hasPurchaseOrderErrors,
  mapPurchaseOrderToForm,
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
    expect(calculateOrderedQuantity(form.items)).toBe(0);
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

  it('keeps product display data when mapping a saved order', () => {
    const form = mapPurchaseOrderToForm({
      id: 12,
      supplier_id: 3,
      order_date: '2026-06-12T00:00:00Z',
      status: 'draft',
      total_amount: '35.00',
      is_active: true,
      created_at: '2026-06-12T00:00:00Z',
      items: [
        {
          id: 7,
          product_id: 9,
          quantity_ordered: 7,
          quantity_received: 0,
          unit_cost: '5.00',
          subtotal: '35.00',
          product: { id: 9, name: 'Salafan', uom: 'metr' },
        },
      ],
    });

    expect(form.items[0]).toMatchObject({
      product_name: 'Salafan',
      product_uom: 'metr',
    });
  });

  it('derives a 4-decimal unit cost from a wholesale total', () => {
    // Одна упаковка колы за 45 при 24 штуках => 1.875 за штуку, без остатка.
    expect(deriveUnitCostFromTotal('45', '24')).toBe('1.875');
  });

  it('rounds a non-terminating unit cost to 4 decimals', () => {
    expect(deriveUnitCostFromTotal('50', '7')).toBe('7.1429');
  });

  it('returns an empty unit cost when quantity cannot divide', () => {
    expect(deriveUnitCostFromTotal('45', '0')).toBe('');
    expect(deriveUnitCostFromTotal('45', '')).toBe('');
    expect(deriveUnitCostFromTotal('', '24')).toBe('');
  });

  it('computes an exact line total from quantity and a 4-decimal unit cost', () => {
    expect(deriveLineTotal('24', '1.875')).toBe(45);
    expect(deriveLineTotal('', '1.875')).toBe(0);
  });

  it('validates receiving against the remaining amount', () => {
    expect(getRemainingQuantity({ quantity_ordered: 10, quantity_received: 4 })).toBe(6);
    expect(validateReceiveQuantity(-1, 6)).toBe('Количество не может быть отрицательным');
    expect(validateReceiveQuantity(7, 6)).toBe('Максимум: 6');
    expect(validateReceiveQuantity(6, 6)).toBeNull();
  });
});
