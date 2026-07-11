import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../format';

describe('formatCurrency', () => {
  it('formats a number as UZS with grouping', () => {
    const out = formatCurrency(1000);
    expect(out).toMatch(/1\D*000/);
    expect(out).toContain('UZS');
  });

  it('parses a numeric string', () => {
    expect(formatCurrency('2500')).toMatch(/2\D*500/);
  });

  it('falls back to 0 for non-numeric input', () => {
    expect(formatCurrency('abc')).toMatch(/0/);
  });
});
