import { describe, expect, it } from 'vitest';

import {
  calculateCashPayment,
  calculateCreditInitialPayment,
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
} from '@/lib/posPricing';

describe('posPricing', () => {
  it('keeps decimal values editable without rounding them to integers', () => {
    expect(formatEditableAmount(7.5)).toBe('7.5');
    expect(formatEditableAmount(22.5)).toBe('22.5');
    expect(formatEditableAmount(150000)).toBe('150000');
  });

  it('calculates item discount from edited unit price', () => {
    expect(calculateDiscountFromEditedPrice('6.5', 7.5)).toBe(1);
    expect(calculateDiscountFromEditedPrice('7.5', 7.5)).toBe(0);
    expect(calculateDiscountFromEditedPrice('8', 7.5)).toBe(-0.5);
    expect(calculateDiscountFromEditedPrice('10', 7.5)).toBe(-2.5);
  });

  it('calculates final POS total from raw subtotal, tax, item discounts, and overall discount', () => {
    const pricing = calculatePosPricing({
      subtotal: 22.5,
      tax: 0,
      itemDiscounts: 3,
      overallDiscount: 2,
    });

    expect(pricing.totalBeforeDiscount).toBe(22.5);
    expect(pricing.totalDiscount).toBe(5);
    expect(pricing.finalTotal).toBe(17.5);
  });

  it('supports selling above listed price (negative discount = markup)', () => {
    const pricing = calculatePosPricing({
      subtotal: 22.5,
      tax: 0,
      itemDiscounts: -2.5,
      overallDiscount: 0,
    });

    expect(pricing.totalDiscount).toBe(-2.5);
    expect(pricing.finalTotal).toBe(25);
  });

  it('calculates cash change using money-safe rounding', () => {
    expect(calculateCashPayment('150.50', 100)).toEqual({
      received: 150.5,
      change: 50.5,
      shortfall: 0,
      isSufficient: true,
    });
  });

  it('reports a shortfall when received cash is below the total', () => {
    expect(calculateCashPayment('99.99', 100)).toEqual({
      received: 99.99,
      change: 0,
      shortfall: 0.01,
      isSufficient: false,
    });
  });

  it('calculates upfront credit payment and remaining debt', () => {
    expect(calculateCreditInitialPayment('40', 100)).toEqual({
      amount: 40,
      remaining: 60,
      exceedsTotal: false,
      isValid: true,
    });
  });

  it('flags upfront credit payments above the sale total', () => {
    expect(calculateCreditInitialPayment('120', 100)).toEqual({
      amount: 120,
      remaining: 0,
      exceedsTotal: true,
      isValid: false,
    });
  });

  it('treats empty upfront credit payment as zero', () => {
    expect(calculateCreditInitialPayment('', 100)).toEqual({
      amount: 0,
      remaining: 100,
      exceedsTotal: false,
      isValid: true,
    });
  });
});
