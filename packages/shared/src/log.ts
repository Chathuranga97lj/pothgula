import { z } from 'zod';

/**
 * §14: reading the activity log. Entries are written by every change (FR-LOG-13);
 * this is the reading side — the filter (FR-LOG-07), one page of entries newest
 * first, and the files it can be taken away as (FR-LOG-08).
 */

/** Who can appear as the actor of an entry: the three roles, or the system itself. */
export const LOG_ROLES = ['member', 'admin', 'super_admin', 'system'] as const;
export type LogRole = (typeof LOG_ROLES)[number];

/** The kinds of action the log screen offers as a filter: the part before the dot. */
export const LOG_ACTION_GROUPS = [
  'auth',
  'application',
  'member',
  'membership',
  'account',
  'staff',
  'super_admin',
  'borrow',
  'request',
  'title',
  'copy',
  'category',
  'branch',
  'library',
  'image',
  'import',
  'log',
  'job',
] as const;

/** The kinds of record an entry can be about — what a "history" tab asks for (FR-LOG-09). */
export const LOG_ENTITIES = [
  'app_user',
  'membership_payment',
  'borrow',
  'book_request',
  'title',
  'copy',
  'category',
  'branch',
  'branch_setting',
  'library',
  'image',
  'import',
  'activity_log',
  'job',
] as const;

export const EXPORT_FORMATS = ['txt', 'csv', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Optional query-string text: absent and empty mean the same thing. */
const optionalText = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().trim().min(1).max(100).optional(),
);
const optionalId = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional(),
);
const optionalDate = z.preprocess((v) => (v === '' ? undefined : v), z.iso.date().optional());

/**
 * FR-LOG-07: date range (library days, inclusive), person, role, branch, kind of
 * action and the record affected. Every part is optional. `action` is either a
 * group (`borrow`) or one action (`borrow.issue`).
 */
export const logFilterSchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    actorId: optionalId,
    role: z.preprocess((v) => (v === '' ? undefined : v), z.enum(LOG_ROLES).optional()),
    branchId: optionalId,
    action: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .regex(/^[a-z_]+(\.[a-z_.]+)?$/)
        .max(60)
        .optional(),
    ),
    entity: z.preprocess((v) => (v === '' ? undefined : v), z.enum(LOG_ENTITIES).optional()),
    entityId: optionalText,
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    message: 'The start date is after the end date.',
    path: ['to'],
  })
  .refine((f) => f.entityId === undefined || f.entity !== undefined, {
    message: 'A record id needs the kind of record.',
    path: ['entityId'],
  });
export type LogFilter = z.infer<typeof logFilterSchema>;

/** One page of the log: the filter, plus where the previous page stopped. */
export const logQuerySchema = z.object({
  /** The id of the last entry already shown; entries older than it come next. */
  before: optionalId,
  limit: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(200).default(100),
  ),
});

export const logEntrySchema = z.object({
  id: z.number().int(),
  at: z.string(),
  actorId: z.number().int().nullable(),
  /** Null for the system, and blank once an applicant is anonymised. */
  actorName: z.string().nullable(),
  actorRole: z.enum(LOG_ROLES),
  branchId: z.number().int().nullable(),
  branchCode: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ipAddress: z.string().nullable(),
  /** Set when an anonymised applicant's values were blanked (FR-LOG-05). */
  redactedAt: z.string().nullable(),
});
export type LogEntryView = z.infer<typeof logEntrySchema>;

export const logPageSchema = z.object({
  entries: z.array(logEntrySchema),
  /** Pass as `before` for the next page; null when there are no older entries. */
  nextBefore: z.number().int().nullable(),
});
export type LogPage = z.infer<typeof logPageSchema>;

const MAX_VALUE_CHARS = 80;

function show(value: unknown): string {
  const text =
    value === null || value === undefined
      ? '—'
      : typeof value === 'string'
        ? value
        : // A space after each comma, so long values can wrap on screen and in a PDF.
          JSON.stringify(value).replace(/,(?=["{[])/g, ', ');
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What an entry changed, in one line per field: `name: old → new` for an edit,
 * `name: value` for something new. Used on screen and in the text and PDF exports;
 * the CSV carries the full before and after values as well.
 */
export function describeChange(before: unknown, after: unknown): string[] {
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`);
  }
  const only = after ?? before;
  if (isRecord(only)) return Object.entries(only).map(([k, v]) => `${k}: ${show(v)}`);
  if (before === null || before === undefined) {
    return after === null || after === undefined ? [] : [show(after)];
  }
  return [`${show(before)} → ${show(after)}`];
}
