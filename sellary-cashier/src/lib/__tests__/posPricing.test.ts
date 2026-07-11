import { describe, it, expect } from 'vitest';
import {
  calculateCashPayment,
  calculateCreditInitialPayment,
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
  parseEditableAmount,
} from '../posPricing';

describe('posPricing golden cases', () => {
  it('computes cash change for sufficient payment', () => {
    const r = calculateCashPayment('12000', 10000);
    expect(r.isSufficient).toBe(true);
    expect(r.change).toBe(2000);
    expect(r.shortfall).toBe(0);
  });

  it('reports a shortfall when cash is insufficient', () => {
    const r = calculateCashPayment('8000', 10000);
    expect(r.isSufficient).toBe(false);
    expect(r.shortfall).toBe(2000);
    expect(r.change).toBe(0);
  });

  it('derives a per-unit discount from an edited price', () => {
    expect(calculateDiscountFromEditedPrice('9000', 10000)).toBe(1000);
    expect(calculateDiscountFromEditedPrice('-5', 10000)).toBe(0);
  });

  it('applies discounts and tax to the final total', () => {
    const r = calculatePosPricing({ subtotal: 10000, tax: 1200, itemDiscounts: 1000, overallDiscount: 0 });
    expect(r.totalBeforeDiscount).toBe(11200);
    expect(r.totalDiscount).toBe(1000);
    expect(r.finalTotal).toBe(10200);
  });

  it('round-trips editable amounts', () => {
    expect(formatEditableAmount(1234)).toBe('1234');
    expect(parseEditableAmount('1 234'.replace(' ', ''))).toBe(1234);
    expect(parseEditableAmount('')).toBeNull();
  });
});

describe('calculateCreditInitialPayment', () => {
  it('treats an empty initial payment as full remaining debt', () => {
    const r = calculateCreditInitialPayment('', 10000);
    expect(r.amount).toBe(0);
    expect(r.remaining).toBe(10000);
    expect(r.exceedsTotal).toBe(false);
    expect(r.isValid).toBe(true);
  });

  it('splits a partial initial payment into paid + remaining', () => {
    const r = calculateCreditInitialPayment('4000', 10000);
    expect(r.amount).toBe(4000);
    expect(r.remaining).toBe(6000);
    expect(r.isValid).toBe(true);
  });

  it('a full initial payment leaves zero remaining and is valid', () => {
    const r = calculateCreditInitialPayment('10000', 10000);
    expect(r.amount).toBe(10000);
    expect(r.remaining).toBe(0);
    expect(r.isValid).toBe(true);
  });

  it('flags an initial payment greater than the total as invalid', () => {
    const r = calculateCreditInitialPayment('12000', 10000);
    expect(r.amount).toBe(12000);
    expect(r.remaining).toBe(0);
    expect(r.exceedsTotal).toBe(true);
    expect(r.isValid).toBe(false);
  });

  it('clamps negative input to zero', () => {
    const r = calculateCreditInitialPayment('-500', 10000);
    expect(r.amount).toBe(0);
    expect(r.remaining).toBe(10000);
    expect(r.isValid).toBe(true);
  });
});
