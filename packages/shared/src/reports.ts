import { z } from 'zod';
import { branchRefSchema } from './dashboard.js';
import { addDays, addMonths } from './dates.js';

/**
 * §15: reports, worked out from live data when asked for. Every report is one
 * table — columns, rows, perhaps a total — so the screen shows any of them the
 * same way and each can be taken away as .txt, .csv or PDF (FR-RPT-09).
 *
 * FR-RPT-12, the year-end summary, is Phase 3.
 */
export const REPORT_KINDS = [
  'summary', // FR-RPT-06
  'stock', // FR-RPT-01
  'loans', // FR-RPT-02
  'popular', // FR-RPT-05
  'borrowing', // FR-RPT-08
  'late', // FR-RPT-15
  'ages', // FR-RPT-11
  'requests', // FR-RPT-14
  'fees', // FR-RPT-03
  'membership', // FR-RPT-04
  'missing', // FR-RPT-07
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** The reports that cover a period, and so take a from and to date. */
export const PERIOD_REPORTS: readonly ReportKind[] = [
  'popular',
  'borrowing',
  'late',
  'requests',
  'fees',
  'membership',
];

/** How many titles the most and least borrowed lists show. */
export const POPULAR_LIMIT = 50;
/** How many members the late-returns list shows. */
export const LATE_LIMIT = 50;
/** The longest period one report may cover. */
export const REPORT_MAX_MONTHS = 60;

/** Without dates chosen, a period report covers the last twelve months to today. */
export function defaultReportPeriod(today: string): { from: string; to: string } {
  return { from: addDays(addMonths(today, -12), 1), to: today };
}

const blank = (v: unknown) => (v === '' ? undefined : v);
const optionalDate = z.preprocess(blank, z.iso.date().optional());

export const reportQuerySchema = z
  .object({
    /** One branch; left out, a super admin sees the whole library (FR-RPT-10). */
    branchId: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : Number(v)),
      z.number().int().positive().optional(),
    ),
    from: optionalDate,
    to: optionalDate,
    /** FR-RPT-05: one category's titles only. */
    category: z.preprocess(
      blank,
      z
        .string()
        .regex(/^[A-Z][0-9]$/)
        .optional(),
    ),
    /** FR-RPT-05: the most borrowed first, or the least. */
    order: z.preprocess(blank, z.enum(['most', 'least']).default('most')),
    /** FR-RPT-01, FR-RPT-10: the whole library's stock by category, or branch by branch. */
    by: z.preprocess(blank, z.enum(['category', 'branch']).default('category')),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date is after the end date.',
    path: ['to'],
  })
  .refine((q) => !q.from || !q.to || addMonths(q.from, REPORT_MAX_MONTHS) >= q.to, {
    message: `A report covers at most ${REPORT_MAX_MONTHS} months.`,
    path: ['from'],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportCellSchema = z.union([z.string(), z.number(), z.null()]);
export type ReportCell = z.infer<typeof reportCellSchema>;

export const reportColumnSchema = z.object({
  /** Stable: the screen words the heading from it (`reports.columns.<key>`). */
  key: z.string(),
  /** The English heading, used in files and when the screen has no wording. */
  label: z.string(),
  numeric: z.boolean(),
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

export const reportRowSchema = z.object({
  cells: z.array(reportCellSchema),
  /** A measure's stable name, for rows that are measures rather than records. */
  key: z.string().nullable(),
  /** Where the row's record opens, such as `/titles/5`. */
  link: z.string().nullable(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  title: z.string(),
  /** What the report covers, in English, as printed on the files. */
  about: z.array(z.string()),
  /** Null for the whole library. */
  branch: branchRefSchema.nullable(),
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
  today: z.iso.date(),
  columns: z.array(reportColumnSchema),
  rows: z.array(reportRowSchema),
  total: z.array(reportCellSchema).nullable(),
});
export type Report = z.infer<typeof reportSchema>;

/** FR-RPT-11: age bands, by completed years on the day of the report. */
export const AGE_BANDS = [
  { key: 'under13', label: 'Under 13', min: 0, max: 12 },
  { key: 'age13to17', label: '13–17', min: 13, max: 17 },
  { key: 'age18to25', label: '18–25', min: 18, max: 25 },
  { key: 'age26to40', label: '26–40', min: 26, max: 40 },
  { key: 'age41to60', label: '41–60', min: 41, max: 60 },
  { key: 'over60', label: '61 and over', min: 61, max: 200 },
] as const;

/** Every month from the one holding `from` to the one holding `to`, as YYYY-MM. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
