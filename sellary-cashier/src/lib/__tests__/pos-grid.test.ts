import { describe, it, expect } from 'vitest';
import { stockBadge, willOversell } from '../pos-grid';

describe('stockBadge', () => {
  it('emerald with remaining count when stock is available', () => {
    expect(stockBadge(5, 'шт', 0)).toEqual({ tone: 'ok', label: '5 шт' });
    expect(stockBadge(5, 'шт', 2)).toEqual({ tone: 'ok', label: '3 шт' });
  });

  it('amber when nothing is left', () => {
    expect(stockBadge(0, 'шт', 0)).toEqual({ tone: 'empty', label: 'нет' });
    expect(stockBadge(5, 'шт', 5)).toEqual({ tone: 'empty', label: 'в корзине' });
  });

  it('red when stock is already negative (oversold)', () => {
    expect(stockBadge(-2, 'шт', 0)).toEqual({ tone: 'oversold', label: '-2 шт' });
  });
});

describe('willOversell', () => {
  it('true once the next unit drives resulting stock to/below zero', () => {
    expect(willOversell(1, 0)).toBe(true);
    expect(willOversell(2, 0)).toBe(false);
    expect(willOversell(3, 2)).toBe(true);
  });
});
