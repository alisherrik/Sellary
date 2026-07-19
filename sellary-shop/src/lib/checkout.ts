import type { CartItem } from './cart';
import type { OrderCreatePayload } from './api';

export interface CheckoutMeta {
  fulfillment_type: 'delivery' | 'pickup';
  delivery_address: string | null;
  contact_phone: string;
  contact_name: string;
  notes: string | null;
}

/**
 * Splits cart items by companyId into per-shop OrderCreatePayload entries.
 * All entries share the same checkout_group_id (a single UUID).
 */
export function splitCartIntoOrders(
  items: CartItem[],
  meta: CheckoutMeta,
): OrderCreatePayload[] {
  // Generate a shared checkout_group_id
  let checkoutGroupId: string;
  try {
    checkoutGroupId = crypto.randomUUID();
  } catch {
    checkoutGroupId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Group items by companyId
  const byCompany = new Map<number, CartItem[]>();
  for (const item of items) {
    const group = byCompany.get(item.companyId) ?? [];
    group.push(item);
    byCompany.set(item.companyId, group);
  }

  return Array.from(byCompany.entries()).map(([companyId, companyItems]) => ({
    company_id: companyId,
    items: companyItems.map(i => ({
      product_id: i.productId,
      quantity: i.quantity,
      unit_price: i.price,
    })),
    fulfillment_type: meta.fulfillment_type,
    delivery_address: meta.delivery_address,
    contact_phone: meta.contact_phone,
    contact_name: meta.contact_name,
    notes: meta.notes,
    checkout_group_id: checkoutGroupId,
  }));
}
