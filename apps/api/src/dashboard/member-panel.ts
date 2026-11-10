import {
  addDays,
  type BookRequest,
  daysBetween,
  type Loan,
  loanStanding,
  type MemberPanelItem,
  MEMBERSHIP_WARNING_DAYS,
  SETTLEMENT_CLOSING_DAYS,
  type Closure,
  type Notice,
  type Settlement,
} from '@pothgula/shared';

export interface MemberFacts {
  status: 'pending' | 'active' | 'suspended' | string;
  expireAt: string | null;
  /** The member's loans, voided ones left out. */
  loans: Loan[];
  /** Their requests for books from other branches, the latest first (§8). */
  requests?: BookRequest[];
  /** Open lost-book settlements (FR-LST-03). */
  settlements?: Settlement[];
  /** Closures at the home branch in the coming week (FR-NOT-08). */
  closures?: Closure[];
  /** Important notices and events not opened yet (FR-PUB-07). */
  important?: Notice[];
  rules: { memberDueWarningDays: number; frequentLateCount: number; frequentLateMonths: number };
  branchName: string;
  feeCents: number;
}

/** A declined request stays on the member's panel this many days. */
const DECLINE_SHOWN_DAYS = 7;

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

  // FR-LST-03, FR-LST-14: the amount and the days counting down; urgent near the end.
  const owed = (facts.settlements ?? []).filter((s) => s.status === 'open');
  for (const s of owed.toSorted((a, b) => a.daysLeft - b.daysLeft)) {
    items.push({
      kind: 'settlement',
      tone: s.daysLeft <= SETTLEMENT_CLOSING_DAYS ? 'urgent' : 'warning',
      settlementId: s.id,
      title: s.title,
      accessionNo: s.accessionNo,
      amountDueCents: s.amountDueCents,
      windowEnds: s.windowEnds,
      daysLeft: s.daysLeft,
    });
  }

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

  // FR-REQ-05: a book from another branch is waiting to be collected.
  const requests = facts.requests ?? [];
  for (const r of requests.filter((x) => x.status === 'held' && x.holdUntil)) {
    items.push({
      kind: 'request_ready',
      tone: 'warning',
      requestId: r.id,
      title: r.title,
      branchName: r.to.name,
      holdUntil: r.holdUntil!,
    });
  }
  // FR-REQ-04: declined in the last week, with the reason.
  const weekAgo = addDays(today, -DECLINE_SHOWN_DAYS);
  for (const r of requests.filter(
    (x) => x.status === 'declined' && (x.decidedAt ?? '').slice(0, 10) >= weekAgo,
  )) {
    items.push({
      kind: 'request_declined',
      tone: 'warning',
      requestId: r.id,
      title: r.title,
      branchName: r.from.name,
      reason: r.declineReason ?? '',
    });
  }

  // FR-CIR-12: a declined request, with the reason, ahead of the due-soon warnings.
  for (const l of open.filter((x) => x.extensionStatus === 'declined')) {
    items.push({
      kind: 'extension_declined',
      tone: 'warning',
      ...ref(l),
      reason: l.extensionReason ?? '',
    });
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

  for (const r of requests.filter((x) => x.status === 'accepted' || x.status === 'in_transit')) {
    items.push({
      kind: 'request_on_way',
      tone: 'info',
      requestId: r.id,
      title: r.title,
      branchName: r.from.name,
      dispatched: r.status === 'in_transit',
    });
  }
  for (const l of open.filter((x) => x.extensionStatus === 'requested')) {
    items.push({ kind: 'extension_pending', tone: 'info', ...ref(l) });
  }
  for (const l of open.filter((x) => x.extensionStatus === 'approved')) {
    items.push({
      kind: 'extension_approved',
      tone: 'info',
      ...ref(l),
      originalDueDate: l.originalDueDate,
    });
  }

  // FR-NOT-08: the home branch closed on a day this week; tomorrow's or today's more prominent.
  for (const c of facts.closures ?? []) {
    items.push({
      kind: 'closure',
      tone: daysBetween(today, c.date) <= 1 ? 'warning' : 'info',
      date: c.date,
      reason: c.reason,
      branchName: facts.branchName,
    });
  }
  // FR-PUB-07: important notices and events, until opened.
  for (const n of facts.important ?? []) {
    items.push({
      kind: 'notice',
      tone: 'info',
      noticeId: n.id,
      noticeKind: n.kind,
      title: n.title,
    });
  }

  const standing = loanStanding(
    facts.loans.map((l) => ({
      dueDate: l.dueDate,
      returnedOn: l.returnedOn,
      voided: false,
      extensionStatus: l.extensionStatus,
      lost: l.status === 'lost',
    })),
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
