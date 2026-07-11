import type { NewSaleInput } from './db';
import { calculateCashPayment, calculatePosPricing } from './posPricing';
import type { CartLine } from './cart-store';

export interface SaleIdentity {
  userId: number | null;
  username: string | null;
}

export type CashierPaymentMethod = 'cash' | 'card' | 'mobile';
export type CashierCardType = 'alif' | 'eskhata' | 'dc';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Fresh unique ids for a new sale (client_sale_id + idempotency_key). */
export function newSaleIds(): { clientSaleId: string; idempotencyKey: string } {
  return {
    clientSaleId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  };
}

/**
 * Build the local NewSaleInput from the cart. Money mirrors the cart totals
 * (calculatePosPricing); sale_items carry base-unit snapshots so the receipt is
 * drift-proof and the sync payload stays base-unit (§7.5). payment_method /
 * card_type are canonical lowercase (§7.4).
 */
export function buildNewSaleInput(params: {
  items: CartLine[];
  paymentMethod: CashierPaymentMethod;
  cardType: CashierCardType | null;
  cashReceived: string;
  cashier: SaleIdentity;
  nowIso: string;
  clientSaleId: string;
  idempotencyKey: string;
}): NewSaleInput {
  const {
    items, paymentMethod, cardType, cashReceived, cashier, nowIso, clientSaleId, idempotencyKey,
  } = params;

  const saleItems = items.map((line, index) => {
    const factor = line.unit.factor || 1;
    const baseQty = round2(line.quantity * factor);
    const baseUnitPrice = round2(line.unit.price / factor);
    const taxPercent = Number(line.product.tax_percent);
    const lineSubtotal = round2(baseUnitPrice * baseQty);
    const lineTotal = round2(lineSubtotal * (1 + taxPercent / 100));
    return {
      product_id: line.product.id,
      product_name: line.product.name,
      barcode: line.product.barcode,
      uom: line.product.uom,
      quantity: baseQty,
      unit_price: baseUnitPrice,
      tax_percent: taxPercent,
      line_subtotal: lineSubtotal,
      line_total: lineTotal,
      sort_order: index,
    };
  });

  const subtotal = round2(
    items.reduce((sum, line) => sum + line.unit.price * line.quantity, 0),
  );
  const taxAmount = round2(
    items.reduce(
      (sum, line) =>
        sum + line.unit.price * line.quantity * (Number(line.product.tax_percent) / 100),
      0,
    ),
  );
  const discountAmount = round2(
    items.reduce((sum, line) => sum + Math.max(0, line.discount || 0), 0),
  );
  const { finalTotal } = calculatePosPricing({
    subtotal,
    tax: taxAmount,
    itemDiscounts: discountAmount,
    overallDiscount: 0,
  });

  const cash = calculateCashPayment(cashReceived, finalTotal);
  const paidAmount = paymentMethod === 'cash' ? cash.received ?? finalTotal : finalTotal;
  const changeAmount = paymentMethod === 'cash' ? cash.change : 0;

  return {
    client_sale_id: clientSaleId,
    idempotency_key: idempotencyKey,
    created_at_client: nowIso,
    payment_method: paymentMethod,
    card_type: paymentMethod === 'card' ? cardType : null,
    subtotal,
    discount_amount: discountAmount,
    tax_amount: taxAmount,
    total_amount: finalTotal,
    paid_amount: paidAmount,
    change_amount: changeAmount,
    notes: null,
    cashier_user_id: cashier.userId,
    cashier_username: cashier.username,
    items: saleItems,
  };
}
