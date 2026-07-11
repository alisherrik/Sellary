import { describe, it, expect } from 'vitest';
import { buildNewSaleInput, newSaleIds } from '../pos-payload';
import type { CartLine } from '../cart-store';
import type { LocalProduct } from '../db';

const product = (over: Partial<LocalProduct> = {}): LocalProduct => ({
  id: 1, barcode: 'B1', name: 'Кола', uom: 'шт', category_id: null,
  sell_price: 5000, tax_percent: 12, stock_quantity: 100, is_active: true,
  updated_at: '2026-01-01', ...over,
});
const line = (over: Partial<CartLine> = {}): CartLine => ({
  product: product(),
  unit: { id: null, label: 'шт', factor: 1, price: 5000 },
  quantity: 2,
  discount: 0,
  ...over,
});

describe('buildNewSaleInput', () => {
  it('computes subtotal, tax, total, and cash change', () => {
    const input = buildNewSaleInput({
      items: [line()],
      paymentMethod: 'cash',
      cardType: null,
      cashReceived: '12000',
      cashier: { userId: 9, username: 'kassir' },
      nowIso: '2026-07-10T10:00:00.000Z',
      clientSaleId: 'cs-1',
      idempotencyKey: 'ik-1',
    });
    expect(input.subtotal).toBe(10000);
    expect(input.tax_amount).toBeCloseTo(1200, 9);
    expect(input.total_amount).toBe(11200);
    expect(input.paid_amount).toBe(12000);
    expect(input.change_amount).toBe(800);
    expect(input.payment_method).toBe('cash');
    expect(input.card_type).toBeNull();
    expect(input.cashier_user_id).toBe(9);
  });

  it('applies a per-unit discount to the sale total', () => {
    const input = buildNewSaleInput({
      items: [line({ discount: 500 })], // 500 off, summed once per web parity
      paymentMethod: 'card',
      cardType: 'alif',
      cashReceived: '',
      cashier: { userId: null, username: null },
      nowIso: '2026-07-10T10:00:00.000Z',
      clientSaleId: 'cs-2',
      idempotencyKey: 'ik-2',
    });
    expect(input.discount_amount).toBe(500);
    expect(input.total_amount).toBe(10700); // 10000 + 1200 - 500
    expect(input.payment_method).toBe('card');
    expect(input.card_type).toBe('alif');
    expect(input.change_amount).toBe(0);
  });

  it('snapshots base-unit item fields', () => {
    const input = buildNewSaleInput({
      items: [line({ unit: { id: 7, label: 'ящик', factor: 12, price: 60000 }, quantity: 1 })],
      paymentMethod: 'mobile',
      cardType: null,
      cashReceived: '',
      cashier: { userId: 1, username: 'k' },
      nowIso: '2026-07-10T10:00:00.000Z',
      clientSaleId: 'cs-3',
      idempotencyKey: 'ik-3',
    });
    const item = input.items[0];
    expect(item.product_id).toBe(1);
    expect(item.product_name).toBe('Кола');
    expect(item.barcode).toBe('B1');
    expect(item.uom).toBe('шт');
    expect(item.quantity).toBe(12);        // 1 box × factor 12 → base units
    expect(item.unit_price).toBe(5000);    // 60000 / 12 → per base unit
    expect(item.tax_percent).toBe(12);
    expect(item.line_subtotal).toBe(60000);
    expect(item.sort_order).toBe(0);
  });
});

describe('buildNewSaleInput — credit (В долг)', () => {
  it('emits a credit sale with customer, partial paid amount and initial method', () => {
    const input = buildNewSaleInput({
      items: [line()], // 2 × 5000 + 12% tax → total 11200
      paymentMethod: 'credit',
      cardType: null,
      cashReceived: '',
      cashier: { userId: 3, username: 'kassir' },
      nowIso: '2026-07-11T10:00:00.000Z',
      clientSaleId: 'cs-credit-1',
      idempotencyKey: 'ik-credit-1',
      customerClientId: 'cust-abc',
      creditPaidAmount: '4000',
      creditPaymentMethod: 'card',
    });
    expect(input.payment_method).toBe('credit');
    expect(input.customer_client_id).toBe('cust-abc');
    expect(input.paid_amount).toBe(4000);
    expect(input.initial_payment_method).toBe('card');
    expect(input.change_amount).toBe(0);
    expect(input.card_type).toBeNull();
    expect(input.total_amount).toBe(11200);
  });

  it('omits initial_payment_method when the initial payment is zero', () => {
    const input = buildNewSaleInput({
      items: [line()],
      paymentMethod: 'credit',
      cardType: null,
      cashReceived: '',
      cashier: { userId: 3, username: 'kassir' },
      nowIso: '2026-07-11T10:00:00.000Z',
      clientSaleId: 'cs-credit-2',
      idempotencyKey: 'ik-credit-2',
      customerClientId: 'cust-abc',
      creditPaidAmount: '',
      creditPaymentMethod: 'cash',
    });
    expect(input.payment_method).toBe('credit');
    expect(input.customer_client_id).toBe('cust-abc');
    expect(input.paid_amount).toBe(0);
    expect(input.initial_payment_method).toBeNull();
  });

  it('leaves customer_client_id null and no initial method for non-credit sales', () => {
    const input = buildNewSaleInput({
      items: [line()],
      paymentMethod: 'cash',
      cardType: null,
      cashReceived: '12000',
      cashier: { userId: 1, username: 'k' },
      nowIso: '2026-07-11T10:00:00.000Z',
      clientSaleId: 'cs-cash-1',
      idempotencyKey: 'ik-cash-1',
    });
    expect(input.customer_client_id).toBeNull();
    expect(input.initial_payment_method).toBeNull();
    expect(input.paid_amount).toBe(12000);
    expect(input.change_amount).toBe(800);
  });
});

describe('newSaleIds', () => {
  it('returns two distinct non-empty ids', () => {
    const { clientSaleId, idempotencyKey } = newSaleIds();
    expect(clientSaleId).toBeTruthy();
    expect(idempotencyKey).toBeTruthy();
    expect(clientSaleId).not.toBe(idempotencyKey);
  });
});
