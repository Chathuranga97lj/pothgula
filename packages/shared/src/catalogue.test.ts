import { describe, expect, it } from 'vitest';
import { createTitleRequestSchema, normalizeIsbn } from './catalogue.js';

describe('normalizeIsbn', () => {
  it('keeps 10 or 13 characters without hyphens or spaces', () => {
    expect(normalizeIsbn('978-955-21-1234-5')).toBe('9789552112345');
    expect(normalizeIsbn('955 21 1234 x')).toBe('955211234X');
  });

  it('rejects anything else', () => {
    for (const bad of ['', '12345', '97895521123456', 'ISBN 955']) {
      expect(normalizeIsbn(bad), bad).toBeNull();
    }
  });
});

describe('createTitleRequestSchema (FR-CAT-01)', () => {
  it('turns empty optional fields into null and normalises the ISBN', () => {
    expect(
      createTitleRequestSchema.parse({
        title: ' මඩොල් දූව ',
        writer: '',
        publisher: 'සරසවි',
        isbn: '978-955-21-1234-5',
        categoryCode: 'A1',
        copies: { branchId: 1, count: 3 },
      }),
    ).toEqual({
      title: 'මඩොල් දූව',
      writer: null,
      publisher: 'සරසවි',
      isbn: '9789552112345',
      edition: null,
      categoryCode: 'A1',
      copies: { branchId: 1, count: 3, source: null, priceCents: undefined },
    });
  });

  it('refuses a malformed ISBN, a bad category, and more than 50 copies at once', () => {
    const base = { title: 'x', categoryCode: 'A1' };
    expect(createTitleRequestSchema.safeParse({ ...base, isbn: '123' }).success).toBe(false);
    expect(createTitleRequestSchema.safeParse({ ...base, categoryCode: 'a1' }).success).toBe(false);
    expect(
      createTitleRequestSchema.safeParse({ ...base, copies: { branchId: 1, count: 51 } }).success,
    ).toBe(false);
  });
});
