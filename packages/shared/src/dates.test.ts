import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, todayColombo } from './dates.js';

describe('todayColombo', () => {
  it('uses Colombo time (UTC+5:30), not UTC', () => {
    // 19:00 UTC on 6 Nov is already 00:30 on 7 Nov in Colombo.
    expect(todayColombo(new Date('2026-11-06T19:00:00Z'))).toBe('2026-11-07');
    // 18:29 UTC is still 23:59 on 6 Nov in Colombo.
    expect(todayColombo(new Date('2026-11-06T18:29:00Z'))).toBe('2026-11-06');
  });
});

describe('addDays / daysBetween', () => {
  it('adds whole calendar days across month and year ends', () => {
    expect(addDays('2026-11-06', 14)).toBe('2026-11-20');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-06', 100)).toBe('2027-02-14');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-11-06', '2026-11-20')).toBe(14);
    expect(daysBetween('2026-11-20', '2026-11-06')).toBe(-14);
  });

  it('rejects malformed or impossible dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('6/11/2026', 1)).toThrow(RangeError);
  });
});
