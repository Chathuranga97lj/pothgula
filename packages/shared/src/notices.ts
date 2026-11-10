import { z } from 'zod';
import { addDays } from './dates.js';

/**
 * §12: notices and events a branch puts in front of its members. Never deleted:
 * a notice is withdrawn, and can be shown again (R12, FR-PUB-03, FR-PUB-06).
 */
export const NOTICE_KINDS = ['notice', 'event'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** FR-PUB-02: an event stays on the member's dashboard this many days after its date. */
export const EVENT_SHOWN_AFTER_DAYS = 7;

/** Where a notice stands today, for the staff list. */
export const NOTICE_STATES = ['shown', 'scheduled', 'ended', 'withdrawn'] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const blank = (v: unknown) => (v === '' ? null : v);
const optionalDate = z.preprocess(blank, z.iso.date().nullable().optional());
const optionalTime = z.preprocess(blank, z.string().regex(TIME).nullable().optional());

/** FR-PUB-01 to FR-PUB-03, FR-PUB-07: what staff write. An edit sends the whole notice again. */
export const noticeInputSchema = z
  .object({
    kind: z.enum(NOTICE_KINDS),
    /** One branch, or null for every branch (super admins only). */
    branchId: z.number().int().positive().nullable(),
    title: z.string().trim().min(1).max(200),
    /** A paragraph; a web address in it is shown as a link. */
    body: z.string().trim().min(1).max(5000),
    eventDate: optionalDate,
    startTime: optionalTime,
    endTime: optionalTime,
    venue: z.preprocess(blank, z.string().trim().max(200).nullable().optional()),
    showFrom: optionalDate,
    showUntil: optionalDate,
    isImportant: z.boolean().default(false),
  })
  .refine((n) => n.kind === 'notice' || (n.eventDate && n.startTime), {
    message: 'An event needs a date and a start time',
    path: ['eventDate'],
  })
  .refine((n) => !n.endTime || !n.startTime || n.endTime > n.startTime, {
    message: 'The end comes after the start',
    path: ['endTime'],
  })
  .refine((n) => !n.showFrom || !n.showUntil || n.showUntil >= n.showFrom, {
    message: 'Hidden after must not be before shown from',
    path: ['showUntil'],
  });
export type NoticeInput = z.input<typeof noticeInputSchema>;
/** A notice as checked, ready to store. */
export type NoticeValues = z.output<typeof noticeInputSchema>;

const isoDate = z.iso.date();
const branchRef = z.object({ id: z.number().int(), code: z.string(), name: z.string() });

export const noticeSchema = z.object({
  id: z.number().int(),
  kind: z.enum(NOTICE_KINDS),
  /** Null: published for every branch. */
  branch: branchRef.nullable(),
  title: z.string(),
  body: z.string(),
  imageId: z.number().int().nullable(),
  eventDate: isoDate.nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  venue: z.string().nullable(),
  showFrom: isoDate.nullable(),
  showUntil: isoDate.nullable(),
  isImportant: z.boolean(),
  withdrawnAt: z.iso.datetime().nullable(),
  createdByName: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  state: z.enum(NOTICE_STATES),
  /** An event whose date has gone (FR-PUB-02). */
  past: z.boolean(),
  /** For the member asking: they have opened it (FR-PUB-07). */
  opened: z.boolean(),
});
export type Notice = z.infer<typeof noticeSchema>;

/** FR-PUB-04: what a branch's members see — notices newest first, events soonest first. */
export const noticeBoardSchema = z.object({
  branch: branchRef,
  notices: z.array(noticeSchema),
  events: z.array(noticeSchema),
});
export type NoticeBoard = z.infer<typeof noticeBoardSchema>;

/**
 * FR-PUB-02, FR-PUB-03: shown today, to members? Not withdrawn, inside its
 * show-from and hide-after dates, and an event no more than a week past.
 */
export function noticeState(
  n: Pick<Notice, 'kind' | 'eventDate' | 'showFrom' | 'showUntil' | 'withdrawnAt'>,
  today: string,
): NoticeState {
  if (n.withdrawnAt) return 'withdrawn';
  if (n.showFrom && n.showFrom > today) return 'scheduled';
  if (n.showUntil && n.showUntil < today) return 'ended';
  if (n.kind === 'event' && n.eventDate && addDays(n.eventDate, EVENT_SHOWN_AFTER_DAYS) < today) {
    return 'ended';
  }
  return 'shown';
}
