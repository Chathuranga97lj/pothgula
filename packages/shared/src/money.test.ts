import { describe, expect, it } from 'vitest';
import { formatRupees, parseRupees } from './money.js';

describe('parseRupees (NFR-14)', () => {
  it('reads rupees and cents exactly, with or without separators and Rs', () => {
    expect(parseRupees('500')).toBe(50_000);
    expect(parseRupees('1,250.50')).toBe(125_050);
    expect(parseRupees('Rs. 0.05')).toBe(5);
    expect(parseRupees(' 19.9 ')).toBe(1_990);
    // 0.1 + 0.2 style float errors cannot happen: no multiplication of decimals.
    expect(parseRupees('1234567.89')).toBe(123_456_789);
  });

  it('rejects anything that is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1,23', '12,3456.00', '1e3']) {
      expect(parseRupees(bad), bad).toBeNull();
    }
  });
});

describe('formatRupees', () => {
  it('writes cents as rupees with two decimals and thousands separators', () => {
    expect(formatRupees(50_000)).toBe('500.00');
    expect(formatRupees(125_050)).toBe('1,250.50');
    expect(formatRupees(5)).toBe('0.05');
    expect(formatRupees(-50_000)).toBe('-500.00');
  });

  it('round-trips', () => {
    for (const cents of [0, 1, 99, 100, 123_456_789]) {
      expect(parseRupees(formatRupees(cents))).toBe(cents);
    }
  });
});
