/**
 * Business dates (NFR-05). The library runs in Asia/Colombo; due dates, holds and
 * settlement windows are whole calendar dates there, never hours. Dates are passed
 * around as ISO strings, `YYYY-MM-DD`.
 */

export const LIBRARY_TIME_ZONE = 'Asia/Colombo';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const colomboDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: LIBRARY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in Colombo at the given instant (default: now). */
export function todayColombo(now: Date = new Date()): string {
  return colomboDate.format(now);
}

function toUtcMidnight(isoDate: string): number {
  if (!ISO_DATE.test(isoDate)) throw new RangeError(`Not an ISO date: ${isoDate}`);
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== isoDate) {
    throw new RangeError(`Not a real date: ${isoDate}`);
  }
  return ms;
}

/** `addDays('2026-11-06', 14)` → `'2026-11-20'`. */
export function addDays(isoDate: string, days: number): string {
  return new Date(toUtcMidnight(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY_MS);
}
