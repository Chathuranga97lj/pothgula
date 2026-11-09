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

/**
 * The same date `years` later. 29 February becomes 28 February in a year without
 * one, so a membership never gains a day (FR-MEM-01).
 */
export function addYears(isoDate: string, years: number): string {
  return addMonths(isoDate, years * 12);
}

/**
 * The same day of the month `months` later (or earlier, if negative), kept
 * within the target month: 31 March minus one month is 28 (or 29) February.
 */
export function addMonths(isoDate: string, months: number): string {
  toUtcMidnight(isoDate);
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/** Whole years of age on a given date (FR-AUT-18). */
export function ageOn(dateOfBirth: string, onDate: string): number {
  toUtcMidnight(dateOfBirth);
  toUtcMidnight(onDate);
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** The last day of the month `isoDate` falls in (FR-NOT-03: "expiring this month"). */
export function endOfMonth(isoDate: string): string {
  return addDays(addMonths(`${isoDate.slice(0, 8)}01`, 1), -1);
}
