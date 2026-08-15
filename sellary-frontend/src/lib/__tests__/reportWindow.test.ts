import { describe, expect, it } from 'vitest';
import { windowStart } from '../reportWindow';

describe('windowStart', () => {
  it('starts N-1 days back, at local midnight', () => {
    // 90 days ending 15 Aug 2026 inclusive => first day is 18 May 2026.
    const start = new Date(windowStart(90, new Date(2026, 7, 15, 14, 30)));

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(18);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('a one-day window is today', () => {
    const start = new Date(windowStart(1, new Date(2026, 7, 15, 14, 30)));

    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
  });

  it('crosses a month boundary', () => {
    const start = new Date(windowStart(7, new Date(2026, 7, 3, 9, 0)));

    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(28);
  });
});
