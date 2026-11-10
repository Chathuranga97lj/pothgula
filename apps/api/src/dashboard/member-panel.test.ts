import type { BookRequest, Closure, Loan, Notice, Settlement } from '@pothgula/shared';
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
    settlementId: null,
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

  it('puts every kind it knows in one order, most urgent first (FR-NOT-07, M14)', () => {
    const request = (status: string, extra: object = {}) =>
      ({
        id: nextId++,
        status,
        title: 'මඩොල් දූව',
        from: { id: 2, code: 'GL', name: 'Galle' },
        to: { id: 1, code: 'KS', name: 'Kesbewa' },
        holdUntil: null,
        decidedAt: null,
        declineReason: null,
        ...extra,
      }) as unknown as BookRequest;
    const settlement = {
      id: 1,
      status: 'open',
      title: 'Gamperaliya',
      accessionNo: 'KS-A1-00009',
      amountDueCents: 150000,
      windowEnds: '2026-12-30',
      daysLeft: 51,
    } as unknown as Settlement;
    const closure: Closure = { id: 1, date: '2026-11-12', reason: 'Poya day' };
    const notice = { id: 5, kind: 'notice', title: 'Water leak' } as unknown as Notice;
    const declined = {
      ...loan('2026-11-11'),
      extensionStatus: 'declined' as const,
      extensionReason: 'x',
    };
    const waiting = { ...loan('2026-11-20'), extensionStatus: 'requested' as const };
    const approved = { ...loan('2026-11-25'), extensionStatus: 'approved' as const };
    expect(
      kinds(
        facts({
          expireAt: '2026-11-30',
          loans: [
            loan('2026-11-01'),
            declined,
            waiting,
            approved,
            loan('2026-10-01', '2026-10-04'),
          ],
          settlements: [settlement],
          requests: [
            request('held', { holdUntil: '2026-11-12' }),
            request('declined', {
              decidedAt: '2026-11-08T05:00:00.000Z',
              declineReason: 'Damaged',
            }),
            request('in_transit'),
          ],
          closures: [closure],
          important: [notice],
        }),
      ),
    ).toEqual([
      'settlement',
      'loan_overdue',
      'request_ready',
      'request_declined',
      'extension_declined',
      'loan_due_soon',
      'membership_expiring',
      'request_on_way',
      'extension_pending',
      'extension_approved',
      'closure',
      'notice',
      'late_returns',
    ]);
  });
});
