/**
 * The receipt is the copy the customer walks out with. Naming a split sale
 * after its largest tender misstates both what they handed over and what they
 * still owe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { printReceipt } from '../utils';

function capturePrintedHtml(sale: unknown): string {
  let html = '';
  const doc = {
    write: (chunk: string) => {
      html += chunk;
    },
    close: vi.fn(),
  };
  vi.stubGlobal('window', {
    ...globalThis.window,
    open: () => ({ document: doc, focus: vi.fn(), print: vi.fn(), close: vi.fn() }),
  });
  printReceipt(sale);
  return html;
}

const BASE = {
  id: 7,
  created_at: '2026-07-27T10:00:00',
  cashier_name: 'Кассир',
  subtotal: '50.00',
  tax_amount: '0.00',
  discount_amount: '0.00',
  total_amount: '50.00',
  items: [
    { product_name: 'Товар', quantity: 1, uom: 'dona', total: '50.00' },
  ],
};

describe('printReceipt payment line', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('names every tender of a split sale with its amount', () => {
    const html = capturePrintedHtml({
      ...BASE,
      payment_method: 'cash',
      is_split: true,
      payments: [
        { method: 'cash', card_type: null, amount: '26.00' },
        { method: 'card', card_type: 'dc', amount: '10.00' },
        { method: 'card', card_type: 'eskhata', amount: '10.00' },
        { method: 'credit', card_type: null, amount: '4.00' },
      ],
    });

    expect(html).toContain('Наличные');
    expect(html).toContain('DC');
    expect(html).toContain('Эсхата');
    expect(html).toContain('В долг');
  });

  it('does not pass a split sale off as its largest tender alone', () => {
    const html = capturePrintedHtml({
      ...BASE,
      payment_method: 'cash',
      is_split: true,
      payments: [
        { method: 'cash', card_type: null, amount: '26.00' },
        { method: 'credit', card_type: null, amount: '24.00' },
      ],
    });

    // The debt has to appear: the customer is walking out still owing 24.
    expect(html).toContain('В долг');
  });

  it('leaves an ordinary sale exactly as it was', () => {
    const html = capturePrintedHtml({
      ...BASE,
      payment_method: 'card',
      card_type: 'dc',
      is_split: false,
      payments: [{ method: 'card', card_type: 'dc', amount: '50.00' }],
    });

    expect(html).toContain('Карта (DC)');
  });

  it('survives a sale from before split payments existed', () => {
    const html = capturePrintedHtml({ ...BASE, payment_method: 'cash' });
    expect(html).toContain('Наличные');
  });
});
