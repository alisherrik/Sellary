import { formatPrice } from '../format';

describe('formatPrice', () => {
  it('formats integer price with thin-space thousands separator', () => {
    expect(formatPrice(12000)).toBe('12 000 с.');
  });
  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0 с.');
  });
  it('formats small number', () => {
    expect(formatPrice(500)).toBe('500 с.');
  });
  it('formats large number', () => {
    expect(formatPrice(1500000)).toBe('1 500 000 с.');
  });
});
