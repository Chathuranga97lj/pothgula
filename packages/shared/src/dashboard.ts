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

/** Most urgent first. */
export const STAFF_ALERTS = [
  'suspended',
  // FR-NOT-09, FR-REQ-14: written off on the road and not found since.
  'lost_in_transit',
  // FR-LST-10, FR-LST-14: a lost-book window passed with the settlement still open.
  'settlements_passed',
  'overdue',
  // FR-REQ-12: a copy on the road longer than the branch allows.
  'transit_overdue',
  // FR-CIR-13: undecided within two days of the due date.
  'extensions_urgent',
  'due_today',
  // FR-LST-14: windows closing within SETTLEMENT_CLOSING_DAYS.
  'settlements_closing',
  'applications_waiting',
  // FR-CIR-12: every extension request waiting for a decision.
  'extensions_waiting',
  // FR-REQ-09: other-branch requests at each step.
  'requests_to_decide',
  'requests_to_send',
  'holds_lapsing',
  'requests_arriving',
  'copies_elsewhere',
  'due_soon',
  // FR-LST-10: every unsettled lost book.
  'settlements_open',
  'returned_late_today',
  'expiring_this_month',
] as const;
export type StaffAlert = (typeof STAFF_ALERTS)[number];

export const ALERT_TONES = ['urgent', 'warning', 'info'] as const;
export type AlertTone = (typeof ALERT_TONES)[number];

export const STAFF_ALERT_TONE: Record<StaffAlert, AlertTone> = {
  suspended: 'urgent',
  lost_in_transit: 'urgent',
  settlements_passed: 'urgent',
  overdue: 'urgent',
  transit_overdue: 'urgent',
  extensions_urgent: 'urgent',
  due_today: 'warning',
  settlements_closing: 'warning',
  applications_waiting: 'warning',
  extensions_waiting: 'warning',
  requests_to_decide: 'warning',
  requests_to_send: 'warning',
  holds_lapsing: 'warning',
  requests_arriving: 'info',
  copies_elsewhere: 'info',
  due_soon: 'info',
  settlements_open: 'info',
  returned_late_today: 'info',
  expiring_this_month: 'info',
};

export const staffCountsSchema = z.object({
  suspended: z.number().int(),
  lost_in_transit: z.number().int(),
  settlements_passed: z.number().int(),
  overdue: z.number().int(),
  /** Members holding an overdue book: the length of the call list. */
  overdueMembers: z.number().int(),
  transit_overdue: z.number().int(),
  extensions_urgent: z.number().int(),
  due_today: z.number().int(),
  settlements_closing: z.number().int(),
  applications_waiting: z.number().int(),
  extensions_waiting: z.number().int(),
  requests_to_decide: z.number().int(),
  requests_to_send: z.number().int(),
  holds_lapsing: z.number().int(),
  requests_arriving: z.number().int(),
  copies_elsewhere: z.number().int(),
  /** Due from today to today + warningDays (includes today's). */
  due_soon: z.number().int(),
  settlements_open: z.number().int(),
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

/** Most urgent first. */
export const memberPanelItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('suspended'), tone: z.literal('urgent') }),
  // FR-LST-03, FR-LST-14: an open lost-book settlement, the amount and the days left.
  z.object({
    kind: z.literal('settlement'),
    tone: z.enum(['urgent', 'warning']),
    settlementId: z.number().int(),
    title: z.string(),
    accessionNo: z.string(),
    amountDueCents: z.number().int(),
    windowEnds: isoDate,
    /** Negative once the window has passed. */
    daysLeft: z.number().int(),
  }),
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
  // FR-REQ-05: a book from another branch is waiting for them.
  z.object({
    kind: z.literal('request_ready'),
    tone: z.literal('warning'),
    requestId: z.number().int(),
    title: z.string(),
    branchName: z.string(),
    holdUntil: isoDate,
  }),
  // FR-REQ-04: declined, with the reason, for a week after the decision.
  z.object({
    kind: z.literal('request_declined'),
    tone: z.literal('warning'),
    requestId: z.number().int(),
    title: z.string(),
    branchName: z.string(),
    reason: z.string(),
  }),
  // FR-REQ-04: accepted, and on its way.
  z.object({
    kind: z.literal('request_on_way'),
    tone: z.literal('info'),
    requestId: z.number().int(),
    title: z.string(),
    branchName: z.string(),
    dispatched: z.boolean(),
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
  // FR-NOT-08: the home branch closed on a day in the coming week.
  z.object({
    kind: z.literal('closure'),
    tone: z.enum(['warning', 'info']),
    date: isoDate,
    reason: z.string(),
    branchName: z.string(),
  }),
  // FR-PUB-07: an important notice or event, until the member has opened it.
  z.object({
    kind: z.literal('notice'),
    tone: z.literal('info'),
    noticeId: z.number().int(),
    noticeKind: z.enum(['notice', 'event']),
    title: z.string(),
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
