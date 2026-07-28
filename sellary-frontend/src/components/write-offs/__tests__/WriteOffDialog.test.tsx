import { describe, expect, it } from 'vitest';

import {
  buildWriteOffPayload,
  validateWriteOff,
  type WriteOffRow,
} from '../WriteOffDialog';

const row = {
  product: { id: 7, name: 'Молоко' },
  unitId: null,
  quantity: '2',
} as unknown as WriteOffRow;

describe('write-off form rules', () => {
  it('refuses a supplier return with no supplier', () => {
    expect(
      validateWriteOff({
        disposition: 'returned_to_supplier',
        supplierId: null,
        rows: [row],
      }),
    ).toBe('Выберите поставщика');
  });

  it('accepts a supplier return once a supplier is chosen', () => {
    expect(
      validateWriteOff({
        disposition: 'returned_to_supplier',
        supplierId: 3,
        rows: [row],
      }),
    ).toBeNull();
  });

  it('accepts a disposal with one row', () => {
    expect(
      validateWriteOff({ disposition: 'disposed', supplierId: null, rows: [row] }),
    ).toBeNull();
  });

  it('refuses an empty document', () => {
    expect(
      validateWriteOff({ disposition: 'disposed', supplierId: null, rows: [] }),
    ).toBe('Добавьте хотя бы один товар');
  });

  it('refuses a document whose only row is zero', () => {
    expect(
      validateWriteOff({
        disposition: 'disposed',
        supplierId: null,
        rows: [{ ...row, quantity: '0' }],
      }),
    ).toBe('Добавьте хотя бы один товар');
  });
});

describe('write-off payload', () => {
  it('drops a stale supplier from a disposal', () => {
    const payload = buildWriteOffPayload({
      disposition: 'disposed',
      reasonCode: 'spoiled',
      supplierId: 3,
      notes: '  ',
      rows: [row],
    });
    expect(payload.supplier_id).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.items).toEqual([
      { product_id: 7, product_unit_id: null, quantity: '2' },
    ]);
  });

  it('keeps the supplier on a return and sends the chosen unit', () => {
    const payload = buildWriteOffPayload({
      disposition: 'returned_to_supplier',
      reasonCode: 'defective',
      supplierId: 3,
      notes: 'вздулись банки',
      rows: [{ ...row, unitId: 12, quantity: '1.5' }],
    });
    expect(payload.supplier_id).toBe(3);
    expect(payload.reason_code).toBe('defective');
    expect(payload.notes).toBe('вздулись банки');
    expect(payload.items).toEqual([
      { product_id: 7, product_unit_id: 12, quantity: '1.5' },
    ]);
  });

  it('leaves out rows with no quantity', () => {
    const payload = buildWriteOffPayload({
      disposition: 'disposed',
      reasonCode: 'spoiled',
      supplierId: null,
      notes: '',
      rows: [row, { ...row, product: { id: 9, name: 'Хлеб' } as never, quantity: '0' }],
    });
    expect(payload.items).toHaveLength(1);
  });
});
