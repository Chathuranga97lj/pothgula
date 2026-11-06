import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('keeps the leading zero of a local mobile number', () => {
    expect(normalizePhone('0771234567')).toBe('0771234567');
  });

  it('drops spaces, hyphens, dots and brackets', () => {
    expect(normalizePhone(' 077 123-4567 ')).toBe('0771234567');
    expect(normalizePhone('(011) 234.5678')).toBe('0112345678');
  });

  it('writes a Sri Lankan international number in its local form', () => {
    expect(normalizePhone('+94 77 123 4567')).toBe('0771234567');
    expect(normalizePhone('94771234567')).toBe('0771234567');
  });

  it('keeps other international numbers with their +', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('rejects anything that is not a phone number', () => {
    for (const bad of ['', 'abc', '12345', '077123456789012345', '07712x4567']) {
      expect(normalizePhone(bad), bad).toBeNull();
    }
  });
});
