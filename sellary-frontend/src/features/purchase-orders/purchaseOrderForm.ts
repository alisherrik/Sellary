import type { PurchaseOrder, PurchaseOrderPayload } from '@/lib/types';

export interface PurchaseOrderItemInput {
  key: string;
  product_id: string;
  product_name?: string;
  product_uom?: string;
  quantity_ordered: string;
  unit_cost: string;
}

export interface PurchaseOrderFormData {
  supplier_id: string;
  expected_delivery_date: string;
  notes: string;
  items: PurchaseOrderItemInput[];
}

export type PurchaseOrderItemErrors = Partial<
  Record<'product_id' | 'quantity_ordered' | 'unit_cost', string>
>;

export interface PurchaseOrderFormErrors {
  supplier_id?: string;
  items_message?: string;
  items: Record<string, PurchaseOrderItemErrors>;
}

export const createPurchaseOrderItemInput = (): PurchaseOrderItemInput => ({
  key: crypto.randomUUID(),
  product_id: '',
  quantity_ordered: '1',
  unit_cost: '',
});

export const createEmptyPurchaseOrderForm = (): PurchaseOrderFormData => ({
  supplier_id: '',
  expected_delivery_date: '',
  notes: '',
  items: [createPurchaseOrderItemInput()],
});

export const mapPurchaseOrderToForm = (order: PurchaseOrder): PurchaseOrderFormData => ({
  supplier_id: String(order.supplier_id),
  expected_delivery_date: order.expected_delivery_date?.slice(0, 10) ?? '',
  notes: order.notes ?? '',
  items: order.items.map((item) => ({
    key: `item-${item.id}`,
    product_id: String(item.product_id),
    product_name: item.product?.name,
    product_uom: item.product?.uom,
    quantity_ordered: String(item.quantity_ordered),
    unit_cost: String(item.unit_cost),
  })),
});

const UNIT_COST_DECIMALS = 4;

/**
 * Back-calculate the per-unit cost from a wholesale line total.
 *
 * Закупка часто идёт оптом (одна упаковка за фиксированную цену), поэтому
 * пользователю удобнее ввести общую сумму, а цену за штуку вычислить.
 * Округляем до 4 знаков, чтобы 45 / 24 = 1.875 не давало остатка.
 * Returns '' when the quantity cannot divide the total (zero/blank/invalid).
 */
export const deriveUnitCostFromTotal = (
  total: string | number,
  quantity: string | number,
): string => {
  const totalValue = Number(total);
  const quantityValue = Number(quantity);
  if (!(quantityValue > 0) || total === '' || !Number.isFinite(totalValue)) {
    return '';
  }
  const unitCost =
    Math.round((totalValue / quantityValue) * 10 ** UNIT_COST_DECIMALS) /
    10 ** UNIT_COST_DECIMALS;
  return String(unitCost);
};

/** Line total for a single row: quantity × unit cost (0 when either is blank/invalid). */
export const deriveLineTotal = (
  quantity: string | number,
  unitCost: string | number,
) => (Number(quantity) || 0) * (Number(unitCost) || 0);

export const calculateOrderTotal = (items: PurchaseOrderItemInput[]) =>
  items.reduce(
    (sum, item) => sum + deriveLineTotal(item.quantity_ordered, item.unit_cost),
    0,
  );

export const calculateOrderedQuantity = (items: PurchaseOrderItemInput[]) =>
  items.reduce(
    (sum, item) =>
      sum + (Number(item.product_id) ? Number(item.quantity_ordered) || 0 : 0),
    0,
  );

export const getDuplicateProductIds = (items: PurchaseOrderItemInput[]) => {
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  items.forEach(({ product_id }) => {
    const id = Number(product_id);
    if (!id) return;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });

  return duplicates;
};

export const validatePurchaseOrderForm = (
  form: PurchaseOrderFormData,
): PurchaseOrderFormErrors => {
  const errors: PurchaseOrderFormErrors = { items: {} };
  if (!Number(form.supplier_id)) errors.supplier_id = 'Выберите поставщика';
  if (!form.items.length) errors.items_message = 'Добавьте хотя бы один товар';

  const duplicates = getDuplicateProductIds(form.items);
  form.items.forEach((item) => {
    const row: PurchaseOrderItemErrors = {};
    const productId = Number(item.product_id);

    if (!productId) row.product_id = 'Выберите товар';
    else if (duplicates.has(productId)) row.product_id = 'Товар уже добавлен';
    if (!(Number(item.quantity_ordered) > 0)) {
      row.quantity_ordered = 'Количество должно быть больше 0';
    }
    if (item.unit_cost === '' || Number(item.unit_cost) < 0) {
      row.unit_cost = 'Укажите цену 0 или больше';
    }
    if (Object.keys(row).length) errors.items[item.key] = row;
  });

  return errors;
};

export const hasPurchaseOrderErrors = (errors: PurchaseOrderFormErrors) =>
  Boolean(
    errors.supplier_id ||
      errors.items_message ||
      Object.keys(errors.items).length,
  );

export const buildPurchaseOrderPayload = (
  form: PurchaseOrderFormData,
): PurchaseOrderPayload => ({
  supplier_id: Number(form.supplier_id),
  expected_delivery_date: form.expected_delivery_date
    ? `${form.expected_delivery_date}T00:00:00.000Z`
    : null,
  notes: form.notes.trim() || null,
  items: form.items.map((item) => ({
    product_id: Number(item.product_id),
    quantity_ordered: Number(item.quantity_ordered),
    unit_cost: Number(item.unit_cost),
  })),
});

export const getRemainingQuantity = (
  item: Pick<PurchaseOrder['items'][number], 'quantity_ordered' | 'quantity_received'>,
) => Math.max(0, Number(item.quantity_ordered) - Number(item.quantity_received));

export const validateReceiveQuantity = (quantity: number, remaining: number) => {
  if (quantity < 0) return 'Количество не может быть отрицательным';
  if (quantity > remaining) return `Максимум: ${remaining}`;
  return null;
};
