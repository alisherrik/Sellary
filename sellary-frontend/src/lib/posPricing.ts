const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function formatEditableAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(roundMoney(value));
}

export function parseEditableAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateCashPayment(value: string, total: number) {
  const parsedReceived = parseEditableAmount(value);
  const roundedTotal = roundMoney(Math.max(0, total));

  if (parsedReceived === null || parsedReceived < 0) {
    return {
      received: null,
      change: 0,
      shortfall: roundedTotal,
      isSufficient: false,
    };
  }

  const received = roundMoney(parsedReceived);
  const difference = roundMoney(received - roundedTotal);

  return {
    received,
    change: difference > 0 ? difference : 0,
    shortfall: difference < 0 ? Math.abs(difference) : 0,
    isSufficient: difference >= 0,
  };
}

export function calculateCreditInitialPayment(value: string, total: number) {
  const parsed = parseEditableAmount(value);
  const roundedTotal = roundMoney(Math.max(0, total));
  const amount = parsed === null ? 0 : roundMoney(Math.max(0, parsed));
  const exceedsTotal = amount > roundedTotal;

  return {
    amount,
    remaining: roundMoney(Math.max(0, roundedTotal - amount)),
    exceedsTotal,
    isValid: !exceedsTotal,
  };
}

export function calculateDiscountFromEditedPrice(value: string, originalPrice: number): number {
  const editedPrice = parseEditableAmount(value);
  if (editedPrice === null || editedPrice < 0) {
    return 0;
  }

  return roundMoney(originalPrice - editedPrice);
}

export function calculatePosPricing({
  subtotal,
  tax,
  itemDiscounts,
  overallDiscount,
}: {
  subtotal: number;
  tax: number;
  itemDiscounts: number;
  overallDiscount: number;
}) {
  const totalBeforeDiscount = roundMoney(subtotal + tax);
  const totalDiscount = roundMoney(itemDiscounts + overallDiscount);
  const finalTotal = roundMoney(Math.max(0, totalBeforeDiscount - totalDiscount));

  return {
    totalBeforeDiscount,
    totalDiscount,
    finalTotal,
  };
}
