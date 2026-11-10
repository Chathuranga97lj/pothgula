import { z } from 'zod';
import { addDays, daysBetween, LIBRARY_TIME_ZONE } from './dates.js';

/**
 * §11: each branch's opening hours — a weekly pattern, and closed dates that
 * override it (Poya days, public holidays, stock-taking). Times are the
 * library's local time, "HH:MM", 24-hour.
 */

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** FR-SCH-05: one closure may cover at most this many days. */
export const CLOSURE_MAX_DAYS = 60;
/** How far ahead the hours screen lists closures. */
export const CLOSURES_AHEAD_DAYS = 90;
/** FR-NOT-08: closures at the home branch this many days ahead are on the member's panel. */
export const CLOSURE_WARNING_DAYS = 7;

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const time = z.string().regex(TIME, 'A time as HH:MM');
const isoDate = z.iso.date();

export const dayHoursSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    /** Both null: closed that day. */
    open: time.nullable(),
    close: time.nullable(),
  })
  .refine((d) => (d.open === null) === (d.close === null), {
    message: 'Give both times, or neither for a closed day',
    path: ['close'],
  })
  .refine((d) => d.open === null || d.close === null || d.open < d.close, {
    message: 'Closing comes after opening',
    path: ['close'],
  });
export type DayHours = z.infer<typeof dayHoursSchema>;

/** FR-SCH-01: the whole week at once. */
export const saveWeekSchema = z.object({
  week: z
    .array(dayHoursSchema)
    .length(7)
    .refine((w) => new Set(w.map((d) => d.weekday)).size === 7, 'Each day once'),
});
export type SaveWeek = z.infer<typeof saveWeekSchema>;

/** FR-SCH-02, FR-SCH-05: one date, or a run of dates, closed with a reason. */
export const addClosureSchema = z
  .object({
    from: isoDate,
    to: isoDate.optional(),
    reason: z.string().trim().min(1).max(200),
  })
  .refine((c) => !c.to || c.to >= c.from, { message: 'The end is before the start', path: ['to'] })
  .refine((c) => !c.to || daysBetween(c.from, c.to) < CLOSURE_MAX_DAYS, {
    message: `At most ${CLOSURE_MAX_DAYS} days at once`,
    path: ['to'],
  });
export type AddClosure = z.infer<typeof addClosureSchema>;

export const closureSchema = z.object({ id: z.number().int(), date: isoDate, reason: z.string() });
export type Closure = z.infer<typeof closureSchema>;

/** FR-SCH-04: today's status, stated plainly. */
export const branchStatusSchema = z.discriminatedUnion('kind', [
  /** No weekly pattern has been set yet. */
  z.object({ kind: z.literal('unknown') }),
  z.object({ kind: z.literal('open'), until: time }),
  z.object({ kind: z.literal('opens_later'), at: time }),
  z.object({
    kind: z.literal('closed'),
    /** Why, when today is a recorded closure. */
    reason: z.string().nullable(),
    /** The next opening, within the coming fortnight. */
    next: z.object({ date: isoDate, at: time }).nullable(),
  }),
]);
export type BranchStatus = z.infer<typeof branchStatusSchema>;

export const branchHoursSchema = z.object({
  branch: z.object({ id: z.number().int(), code: z.string(), name: z.string() }),
  /** False until staff have set a weekly pattern. */
  configured: z.boolean(),
  week: z.array(dayHoursSchema),
  /** Upcoming closures, soonest first. */
  closures: z.array(closureSchema),
  today: isoDate,
  status: branchStatusSchema,
});
export type BranchHours = z.infer<typeof branchHoursSchema>;

// ─── Working it out ─────────────────────────────────────────────────────────

/** The ISO weekday (1 Monday … 7 Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The library's local time now, as HH:MM. */
export function nowColomboTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LIBRARY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

export interface Timetable {
  configured: boolean;
  week: DayHours[];
  closures: Closure[];
}

/** The hours on one date: null when closed (by the pattern or a closure). */
export function hoursOn(date: string, t: Timetable): { open: string; close: string } | null {
  if (t.closures.some((c) => c.date === date)) return null;
  const d = t.week.find((w) => w.weekday === weekdayOf(date));
  return d && d.open && d.close ? { open: d.open, close: d.close } : null;
}

/** FR-SCH-04: open until …, opens at …, or closed today (and why, and when next open). */
export function branchStatus(date: string, now: string, t: Timetable): BranchStatus {
  if (!t.configured) return { kind: 'unknown' };
  const today = hoursOn(date, t);
  if (today && now < today.close) {
    return now >= today.open
      ? { kind: 'open', until: today.close }
      : { kind: 'opens_later', at: today.open };
  }
  const closure = t.closures.find((c) => c.date === date);
  let next: { date: string; at: string } | null = null;
  for (let i = 1; i <= 14 && next === null; i++) {
    const d = addDays(date, i);
    const h = hoursOn(d, t);
    if (h) next = { date: d, at: h.open };
  }
  return { kind: 'closed', reason: closure?.reason ?? null, next };
}

/**
 * The first day from `date` on which the branch opens. Used so that a last day
 * — such as a hold's — never falls on a closed day. Without a weekly pattern,
 * or with none open in the next month, the date itself.
 */
export function nextOpenDay(date: string, t: Timetable): string {
  if (!t.configured) return date;
  for (let i = 0; i <= 31; i++) {
    const d = addDays(date, i);
    if (hoursOn(d, t)) return d;
  }
  return date;
}
