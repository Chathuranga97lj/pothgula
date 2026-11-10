import type { Loan } from '@pothgula/shared';
import { describe, expect, it } from 'vitest';
import { type MemberFacts, memberPanel } from './member-panel';

const today = '2026-11-09';
let nextId = 1;
const loan = (dueDate: string, returnedOn: string | null = null): Loan => {
  const overdue = returnedOn === null && dueDate < today;
  const id = nextId++;
  return {
    id,
    copyId: id,
    accessionNo: `KS-A1-0000${id}`,
    titleId: 1,
    title: 'ගම් මඟ',
    writer: null,
    memberId: 1,
    memberName: 'Nimali',
    memberPhone: null,
    branchId: 1,
    borrowDate: '2026-10-01',
    dueDate,
    originalDueDate: dueDate,
    returnedOn,
    status: returnedOn ? 'returned' : 'open',
    overdue,
    daysLate: overdue ? Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000) : 0,
    isBackdated: false,
    returnBackdated: false,
    voidedAt: null,
    voidReason: null,
    extensionStatus: 'none',
    extensionRequestedAt: null,
    extensionDecidedAt: null,
    extensionReason: null,
  };
};
const facts = (over: Partial<MemberFacts>): MemberFacts => ({
  status: 'active',
  expireAt: '2027-06-01',
  loans: [],
  rules: { memberDueWarningDays: 5, frequentLateCount: 3, frequentLateMonths: 12 },
  branchName: 'Kesbewa',
  feeCents: 50_000,
  ...over,
});
const kinds = (f: MemberFacts) => memberPanel(f, today).map((i) => i.kind);

describe('memberPanel (FR-NOT-01, FR-NOT-02, FR-NOT-08)', () => {
  it('orders everything most urgent first', () => {
    expect(
      kinds(
        facts({
          status: 'suspended',
          expireAt: '2026-11-08',
          loans: [loan('2026-11-12'), loan('2026-11-05'), loan('2026-10-01', '2026-10-04')],
        }),
      ),
    ).toEqual(['suspended', 'loan_overdue', 'loan_due_soon', 'late_returns']);
  });

  it('places an expired membership after overdue books, an expiring one after due books', () => {
    expect(kinds(facts({ expireAt: '2026-11-08', loans: [loan('2026-11-01')] }))).toEqual([
      'loan_overdue',
      'membership_expired',
    ]);
    expect(kinds(facts({ expireAt: '2026-12-09', loans: [loan('2026-11-14')] }))).toEqual([
      'loan_due_soon',
      'membership_expiring',
    ]);
    expect(kinds(facts({ expireAt: '2026-12-10' }))).toEqual([]);
  });

  it('uses the branch setting for how early a due book is mentioned', () => {
    const due = [loan('2026-11-11')];
    expect(kinds(facts({ loans: due }))).toEqual(['loan_due_soon']);
    expect(
      kinds(facts({ loans: due, rules: { ...facts({}).rules, memberDueWarningDays: 1 } })),
    ).toEqual([]);
  });

  it('counts only late returns inside the period', () => {
    expect(kinds(facts({ loans: [loan('2025-06-01', '2025-06-10')] }))).toEqual([]);
  });

  it('gives an applicant only what to bring', () => {
    expect(memberPanel(facts({ status: 'pending', expireAt: null }), today)).toEqual([
      { kind: 'application_waiting', tone: 'info', branchName: 'Kesbewa', feeCents: 50_000 },
    ]);
  });
});
