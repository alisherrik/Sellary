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
