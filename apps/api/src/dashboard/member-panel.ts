import {
  daysBetween,
  type Loan,
  loanStanding,
  type MemberPanelItem,
  MEMBERSHIP_WARNING_DAYS,
} from '@pothgula/shared';

export interface MemberFacts {
  status: 'pending' | 'active' | 'suspended' | string;
  expireAt: string | null;
  /** The member's loans, voided ones left out. */
  loans: Loan[];
  rules: { memberDueWarningDays: number; frequentLateCount: number; frequentLateMonths: number };
  branchName: string;
  feeCents: number;
}

/**
 * FR-NOT-01, FR-NOT-02, FR-NOT-08: what a member's panel shows today, most
 * urgent first. Worked out each time it is asked for (FR-NOT-10).
 */
export function memberPanel(facts: MemberFacts, today: string): MemberPanelItem[] {
  if (facts.status === 'pending') {
    return [
      {
        kind: 'application_waiting',
        tone: 'info',
        branchName: facts.branchName,
        feeCents: facts.feeCents,
      },
    ];
  }

  const items: MemberPanelItem[] = [];
  if (facts.status === 'suspended') items.push({ kind: 'suspended', tone: 'urgent' });

  const open = facts.loans.filter((l) => l.status === 'open');
  const ref = (l: Loan) => ({
    loanId: l.id,
    title: l.title,
    accessionNo: l.accessionNo,
    dueDate: l.dueDate,
  });

  // A stronger warning every day it stays out: the count goes up each day (FR-NOT-01).
  for (const l of open.filter((x) => x.overdue).toSorted((a, b) => b.daysLate - a.daysLate)) {
    items.push({ kind: 'loan_overdue', tone: 'urgent', ...ref(l), daysLate: l.daysLate });
  }

  const expiry = facts.status === 'active' ? facts.expireAt : null;
  const left = expiry ? daysBetween(today, expiry) : null;
  if (expiry && left !== null && left < 0) {
    items.push({ kind: 'membership_expired', tone: 'urgent', expireAt: expiry });
  }

  const soon = open
    .map((l) => ({ l, daysLeft: daysBetween(today, l.dueDate) }))
    .filter((x) => x.daysLeft >= 0 && x.daysLeft <= facts.rules.memberDueWarningDays)
    .toSorted((a, b) => a.daysLeft - b.daysLeft);
  for (const { l, daysLeft } of soon) {
    items.push({ kind: 'loan_due_soon', tone: 'warning', ...ref(l), daysLeft });
  }

  if (expiry && left !== null && left >= 0 && left <= MEMBERSHIP_WARNING_DAYS) {
    items.push({ kind: 'membership_expiring', tone: 'warning', expireAt: expiry, daysLeft: left });
  }

  const standing = loanStanding(
    facts.loans.map((l) => ({ dueDate: l.dueDate, returnedOn: l.returnedOn, voided: false })),
    today,
    { maxBooks: 1, ...facts.rules },
  );
  if (standing.lateReturns > 0) {
    items.push({
      kind: 'late_returns',
      tone: 'info',
      count: standing.lateReturns,
      months: facts.rules.frequentLateMonths,
    });
  }
  return items;
}
