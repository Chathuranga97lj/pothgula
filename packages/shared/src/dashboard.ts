import { z } from 'zod';
import { loanSchema } from './circulation.js';

/**
 * §13 alerts and the lists behind them. Everything here is worked out from live
 * data when it is asked for (FR-NOT-10); nothing is stored or queued, so an item
 * goes as soon as the thing behind it is dealt with (FR-NOT-07).
 */

const isoDate = z.iso.date();

/** FR-NOT-12: a loan on the five-day or overdue list, with what the caller needs. */
export const dueLoanSchema = loanSchema.extend({
  memberOtherPhone: z.string().nullable(),
  memberBranchCode: z.string(),
  copyBranchCode: z.string(),
});
export type DueLoan = z.infer<typeof dueLoanSchema>;

export const branchRefSchema = z.object({
  branchId: z.number().int(),
  branchCode: z.string(),
  branchName: z.string(),
});
export type BranchRef = z.infer<typeof branchRefSchema>;

/** FR-NOT-04, FR-NOT-09, FR-NOT-12: one branch's due, overdue and late-today loans. */
export const branchDueSchema = branchRefSchema.extend({
  /** The branch's staff warning, in days (a setting). */
  warningDays: z.number().int(),
  /** Overdue, held above the five-day list; longest overdue first. */
  overdue: z.array(dueLoanSchema),
  /** Due from today to today + warningDays, soonest first. */
  dueSoon: z.array(dueLoanSchema),
  /** Taken back today, late. */
  returnedLateToday: z.array(dueLoanSchema),
});
export type BranchDue = z.infer<typeof branchDueSchema>;

/** An admin gets their own branch; a super admin every branch (or the one asked for). */
export const dueListsSchema = z.object({
  today: isoDate,
  branches: z.array(branchDueSchema),
});
export type DueLists = z.infer<typeof dueListsSchema>;

/** FR-NOT-04: one person to telephone, with their overdue books. */
export interface CallListEntry {
  memberId: number;
  fullName: string;
  whatsappPhone: string | null;
  otherPhone: string | null;
  loans: DueLoan[];
  /** The longest any of their books is overdue. */
  maxDaysLate: number;
}

/** FR-NOT-04: overdue loans grouped by member, the longest overdue first. */
export function callList(overdue: DueLoan[]): CallListEntry[] {
  const byMember = new Map<number, CallListEntry>();
  for (const loan of overdue) {
    const entry = byMember.get(loan.memberId) ?? {
      memberId: loan.memberId,
      fullName: loan.memberName,
      whatsappPhone: loan.memberPhone,
      otherPhone: loan.memberOtherPhone,
      loans: [],
      maxDaysLate: 0,
    };
    entry.loans.push(loan);
    entry.maxDaysLate = Math.max(entry.maxDaysLate, loan.daysLate);
    byMember.set(loan.memberId, entry);
  }
  return [...byMember.values()]
    .map((e) => ({ ...e, loans: e.loans.toSorted((a, b) => b.daysLate - a.daysLate) }))
    .toSorted((a, b) => b.maxDaysLate - a.maxDaysLate || a.fullName.localeCompare(b.fullName));
}

// ─── The staff panel (FR-NOT-03, FR-NOT-07, FR-NOT-09) ───────────────────────

/** Most urgent first. Extension, request and lost-book items arrive with M10–M12. */
export const STAFF_ALERTS = [
  'suspended',
  'overdue',
  // FR-CIR-13: undecided within two days of the due date.
  'extensions_urgent',
  'due_today',
  'applications_waiting',
  // FR-CIR-12: every extension request waiting for a decision.
  'extensions_waiting',
  'due_soon',
  'returned_late_today',
  'expiring_this_month',
] as const;
export type StaffAlert = (typeof STAFF_ALERTS)[number];

export const ALERT_TONES = ['urgent', 'warning', 'info'] as const;
export type AlertTone = (typeof ALERT_TONES)[number];

export const STAFF_ALERT_TONE: Record<StaffAlert, AlertTone> = {
  suspended: 'urgent',
  overdue: 'urgent',
  extensions_urgent: 'urgent',
  due_today: 'warning',
  applications_waiting: 'warning',
  extensions_waiting: 'warning',
  due_soon: 'info',
  returned_late_today: 'info',
  expiring_this_month: 'info',
};

export const staffCountsSchema = z.object({
  suspended: z.number().int(),
  overdue: z.number().int(),
  /** Members holding an overdue book: the length of the call list. */
  overdueMembers: z.number().int(),
  extensions_urgent: z.number().int(),
  due_today: z.number().int(),
  applications_waiting: z.number().int(),
  extensions_waiting: z.number().int(),
  /** Due from today to today + warningDays (includes today's). */
  due_soon: z.number().int(),
  returned_late_today: z.number().int(),
  expiring_this_month: z.number().int(),
});
export type StaffCounts = z.infer<typeof staffCountsSchema>;

export const panelItemSchema = z.object({
  kind: z.enum(STAFF_ALERTS),
  tone: z.enum(ALERT_TONES),
  count: z.number().int().positive(),
});
export type PanelItem = z.infer<typeof panelItemSchema>;

/** The panel for one branch: only what needs attention, most urgent first. */
export function staffPanel(counts: StaffCounts): PanelItem[] {
  return STAFF_ALERTS.filter((kind) => counts[kind] > 0).map((kind) => ({
    kind,
    tone: STAFF_ALERT_TONE[kind],
    count: counts[kind],
  }));
}

export const staffDashboardSchema = z.object({
  today: isoDate,
  /** For "expiring this month". */
  monthEnd: isoDate,
  branches: z.array(
    branchRefSchema.extend({
      warningDays: z.number().int(),
      counts: staffCountsSchema,
      items: z.array(panelItemSchema),
    }),
  ),
});
export type StaffDashboard = z.infer<typeof staffDashboardSchema>;

// ─── The member panel (FR-NOT-01, FR-NOT-02, FR-NOT-07, FR-NOT-08) ───────────

const loanRef = {
  loanId: z.number().int(),
  title: z.string(),
  accessionNo: z.string(),
  dueDate: isoDate,
};

/** Most urgent first. Request, settlement and closure items arrive with M11–M13. */
export const memberPanelItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('suspended'), tone: z.literal('urgent') }),
  z.object({
    kind: z.literal('loan_overdue'),
    tone: z.literal('urgent'),
    ...loanRef,
    daysLate: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('membership_expired'), tone: z.literal('urgent'), expireAt: isoDate }),
  z.object({
    kind: z.literal('loan_due_soon'),
    tone: z.literal('warning'),
    ...loanRef,
    daysLeft: z.number().int().nonnegative(),
  }),
  // FR-CIR-12: the member's extension request, waiting or decided, while the book is out.
  z.object({
    kind: z.literal('extension_declined'),
    tone: z.literal('warning'),
    ...loanRef,
    reason: z.string(),
  }),
  z.object({ kind: z.literal('extension_pending'), tone: z.literal('info'), ...loanRef }),
  z.object({
    kind: z.literal('extension_approved'),
    tone: z.literal('info'),
    ...loanRef,
    originalDueDate: isoDate,
  }),
  z.object({
    kind: z.literal('membership_expiring'),
    tone: z.literal('warning'),
    expireAt: isoDate,
    daysLeft: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('late_returns'),
    tone: z.literal('info'),
    count: z.number().int().positive(),
    months: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('application_waiting'),
    tone: z.literal('info'),
    branchName: z.string(),
    /** The first fee to bring, in cents (0 if none is set). */
    feeCents: z.number().int().nonnegative(),
  }),
]);
export type MemberPanelItem = z.infer<typeof memberPanelItemSchema>;

export const memberDashboardSchema = z.object({
  today: isoDate,
  items: z.array(memberPanelItemSchema),
});
export type MemberDashboard = z.infer<typeof memberDashboardSchema>;

/** FR-NOT-02: a member is warned this many days before their membership ends. */
export const MEMBERSHIP_WARNING_DAYS = 30;
