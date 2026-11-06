import { describe, expect, it } from 'vitest';
import {
  formatAccession,
  isCanonicalAccession,
  normalizeAccession,
  parseAccession,
} from './accession.js';

describe('formatAccession', () => {
  it('pads the running number to five digits', () => {
    expect(formatAccession('KS', 'A1', 1234)).toBe('KS-A1-01234');
    expect(formatAccession('GL', 'B9', 1)).toBe('GL-B9-00001');
    expect(formatAccession('KS', 'A1', 99_999)).toBe('KS-A1-99999');
  });

  it('refuses numbers outside 1..99999 and malformed codes', () => {
    expect(() => formatAccession('KS', 'A1', 0)).toThrow(RangeError);
    expect(() => formatAccession('KS', 'A1', 100_000)).toThrow(RangeError);
    expect(() => formatAccession('KS', 'A1', 1.5)).toThrow(RangeError);
    expect(() => formatAccession('K', 'A1', 1)).toThrow(RangeError);
    expect(() => formatAccession('KS', '1A', 1)).toThrow(RangeError);
  });
});

describe('parseAccession', () => {
  it('accepts the number typed with or without hyphens, in any case', () => {
    const expected = { branchCode: 'KS', categoryCode: 'A1', running: 1234 };
    expect(parseAccession('KS-A1-01234')).toEqual(expected);
    expect(parseAccession('KSA101234')).toEqual(expected);
    expect(parseAccession(' ks-a1-01234 ')).toEqual(expected);
  });

  it('rejects anything else', () => {
    for (const bad of [
      'KS-A1-1234',
      'KS-AA-01234',
      'K1-A1-01234',
      'KS-A1-00000',
      'KS--A1-01234',
      '',
    ]) {
      expect(parseAccession(bad), bad).toBeNull();
    }
  });
});

describe('normalizeAccession / isCanonicalAccession', () => {
  it('produces the printed form', () => {
    expect(normalizeAccession('gla201234')).toBe('GL-A2-01234');
    expect(normalizeAccession('nonsense')).toBeNull();
  });

  it('recognises only the stored form', () => {
    expect(isCanonicalAccession('KS-A1-01234')).toBe(true);
    expect(isCanonicalAccession('KSA101234')).toBe(false);
    expect(isCanonicalAccession('KS-A1-00000')).toBe(false);
  });
});
