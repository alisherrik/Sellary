import { describe, it, expect } from 'vitest';
import { remainingStock, nextAddQuantity, canAdd, isOverStock } from '../posStock';

describe('posStock parity', () => {
  it('remainingStock never goes below zero', () => {
    expect(remainingStock(5, 2)).toBe(3);
    expect(remainingStock(5, 9)).toBe(0);
    expect(remainingStock('10', 4)).toBe(6);
  });

  it('nextAddQuantity caps at one base unit or the remainder', () => {
    expect(nextAddQuantity(5, 0)).toBe(1);
    expect(nextAddQuantity(0.4, 0)).toBeCloseTo(0.4, 9);
    expect(nextAddQuantity(5, 5)).toBe(0);
  });

  it('canAdd respects the epsilon boundary', () => {
    expect(canAdd(5, 4, 1)).toBe(true);
    expect(canAdd(5, 5, 1)).toBe(false);
  });

  it('isOverStock detects a cart beyond available stock', () => {
    expect(isOverStock(5, 6)).toBe(true);
    expect(isOverStock(5, 5)).toBe(false);
  });
});
