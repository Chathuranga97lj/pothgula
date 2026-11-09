import { z } from 'zod';
import { normalizeAccession } from './accession.js';
import { COPY_STATES } from './catalogue.js';
import { addMonths, daysBetween } from './dates.js';

/**
 * Circulation (§7): issuing, taking back, correcting and voiding loans.
 * Days late, overdue and the late-return count are worked out from the dates,
 * never stored (R2).
 */

/** FR-CIR-14: a paper transaction may be entered up to seven days after it happened. */
export const BACKDATE_MAX_DAYS = 7;

/**
 * Days late: from the due date to the day it came back, or to today while it is
 * still out. A book returned on its due date is not late. A voided loan is never late.
 */
export function daysLate(
  loan: { dueDate: string; returnedOn: string | null; voided?: boolean },
  today: string,
): number {
  if (loan.voided) return 0;
  return Math.max(0, daysBetween(loan.dueDate, loan.returnedOn ?? today));
}

/** Still out and past its due date (FR-CIR-02). */
export function isOverdue(
  loan: { dueDate: string; returnedOn: string | null; voided?: boolean },
  today: string,
): boolean {
  return !loan.voided && loan.returnedOn === null && loan.dueDate < today;
}

/** Where a member stands with their loans, as shown at the top of their record. */
export function loanStanding(
  loans: { dueDate: string; returnedOn: string | null; voided: boolean }[],
  today: string,
  rules: { maxBooks: number; frequentLateCount: number; frequentLateMonths: number },
): LoanStanding {
  const counted = loans.filter((l) => !l.voided);
  const since = addMonths(today, -rules.frequentLateMonths);
  const lateReturns = counted.filter(
    (l) => l.returnedOn !== null && l.returnedOn > l.dueDate && l.returnedOn > since,
  ).length;
  return {
    openLoans: counted.filter((l) => l.returnedOn === null).length,
    maxBooks: rules.maxBooks,
    overdueLoans: counted.filter((l) => isOverdue(l, today)).length,
    lateReturns,
    lateReturnMonths: rules.frequentLateMonths,
    frequentlyLate: lateReturns >= rules.frequentLateCount,
  };
}

// ─── Requests ───────────────────────────────────────────────────────────────

const isoDate = z.iso.date();

/** An accession number as staff type it (`ks-a1-1234`, `KSA101234`), made canonical. */
export const accessionInputSchema = z.string().transform((value, ctx) => {
  const accessionNo = normalizeAccession(value);
  if (!accessionNo) {
    ctx.addIssue({ code: 'custom', message: 'Not an accession number, for example KS-A1-01234' });
    return z.NEVER;
  }
  return accessionNo;
});

const reasonField = z.string().trim().min(1).max(500);

/** FR-CIR-01; with `borrowDate`, a back-dated paper loan (FR-CIR-14). */
export const issueRequestSchema = z.object({
  memberId: z.number().int().positive(),
  accessionNo: accessionInputSchema,
  borrowDate: isoDate.optional(),
});
export type IssueRequest = z.input<typeof issueRequestSchema>;

/** FR-CIR-03, FR-CIR-08; with `returnedOn`, a back-dated paper take-back (FR-CIR-14). */
export const returnRequestSchema = z.object({
  returnedOn: isoDate.optional(),
  /** The book came back damaged: it is set aside as not useable, not shelved. */
  notUseable: z.boolean().optional(),
});
export type ReturnRequest = z.input<typeof returnRequestSchema>;

/**
 * FR-CIR-05: wrong copy, wrong member or wrong date. Changing the borrow date
 * moves the due date with it. `returnedOn: null` undoes a take-back recorded
 * by mistake. The reason is kept in the log with the old and new values.
 */
export const correctLoanRequestSchema = z
  .object({
    accessionNo: accessionInputSchema.optional(),
    memberId: z.number().int().positive().optional(),
    borrowDate: isoDate.optional(),
    returnedOn: isoDate.nullable().optional(),
    reason: reasonField,
  })
  .refine(
    (v) =>
      v.accessionNo !== undefined ||
      v.memberId !== undefined ||
      v.borrowDate !== undefined ||
      v.returnedOn !== undefined,
    { message: 'Nothing to change' },
  );
export type CorrectLoanRequest = z.input<typeof correctLoanRequestSchema>;

/** FR-CIR-05: a loan entered entirely by mistake (super admin). */
export const voidLoanRequestSchema = z.object({ reason: reasonField });

// ─── Responses ──────────────────────────────────────────────────────────────

/**
 * Why a copy cannot be issued to a member (FR-CIR-02). Each is also an error
 * code, translated by the web app. Phase 2 adds in transit, held for another
 * member, and the open-settlement limit.
 */
export const ISSUE_REFUSALS = [
  'copy_on_loan',
  'copy_missing',
  'copy_not_useable',
  'copy_withdrawn',
  'copy_other_branch',
  'member_pending',
  'member_suspended',
  'member_deactivated',
  'member_rejected',
  'member_expired',
  'member_overdue',
  'member_at_limit',
] as const;
export type IssueRefusalCode = (typeof ISSUE_REFUSALS)[number];

export const issueRefusalSchema = z.object({
  code: z.enum(ISSUE_REFUSALS),
  /** Values for the message: `max` for the limit, `count` for overdue books. */
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type IssueRefusal = z.infer<typeof issueRefusalSchema>;

export const LOAN_STATUSES = ['open', 'returned', 'void'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const loanSchema = z.object({
  id: z.number().int(),
  copyId: z.number().int(),
  accessionNo: z.string(),
  titleId: z.number().int(),
  title: z.string(),
  writer: z.string().nullable(),
  memberId: z.number().int(),
  memberName: z.string(),
  memberPhone: z.string().nullable(),
  /** The branch it was issued at. */
  branchId: z.number().int(),
  borrowDate: isoDate,
  dueDate: isoDate,
  originalDueDate: isoDate,
  returnedOn: isoDate.nullable(),
  status: z.enum(LOAN_STATUSES),
  overdue: z.boolean(),
  /** To today while out; to the return date once back (FR-CIR-04). */
  daysLate: z.number().int(),
  /** FR-CIR-14: the issue, or the take-back, was entered later from paper. */
  isBackdated: z.boolean(),
  returnBackdated: z.boolean(),
  voidedAt: z.iso.datetime().nullable(),
  voidReason: z.string().nullable(),
});
export type Loan = z.infer<typeof loanSchema>;

/** FR-CIR-06, FR-CIR-15, FR-NOT-11 (loan parts): the top of a member's record. */
export const loanStandingSchema = z.object({
  openLoans: z.number().int(),
  maxBooks: z.number().int(),
  overdueLoans: z.number().int(),
  /** Late returns within the last `lateReturnMonths` months. */
  lateReturns: z.number().int(),
  lateReturnMonths: z.number().int(),
  frequentlyLate: z.boolean(),
});
export type LoanStanding = z.infer<typeof loanStandingSchema>;

/** FR-CIR-09: a member's whole borrowing history, most recent first. */
export const memberLoansSchema = z.object({
  standing: loanStandingSchema,
  loans: z.array(loanSchema),
});
export type MemberLoans = z.infer<typeof memberLoansSchema>;

/** What the counter sees before confirming an issue: the book, the dates, any refusals. */
export const issueCheckSchema = z.object({
  member: z.object({
    id: z.number().int(),
    fullName: z.string(),
    branchId: z.number().int().nullable(),
  }),
  copy: z.object({
    id: z.number().int(),
    accessionNo: z.string(),
    titleId: z.number().int(),
    title: z.string(),
    writer: z.string().nullable(),
    branchId: z.number().int(),
    state: z.enum(COPY_STATES),
  }),
  borrowDate: isoDate,
  dueDate: isoDate,
  isBackdated: z.boolean(),
  standing: loanStandingSchema,
  refusals: z.array(issueRefusalSchema),
});
export type IssueCheck = z.infer<typeof issueCheckSchema>;
