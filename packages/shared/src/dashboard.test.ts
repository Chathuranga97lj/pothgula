import { describe, expect, it } from 'vitest';
import { callList, type DueLoan, type StaffCounts, staffPanel } from './dashboard.js';
import { endOfMonth } from './dates.js';

const loan = (over: Partial<DueLoan>): DueLoan => ({
  id: 1,
  copyId: 1,
  accessionNo: 'KS-A1-00001',
  titleId: 1,
  title: 'ගම් මඟ',
  writer: null,
  memberId: 1,
  memberName: 'Nimali Silva',
  memberPhone: '0771234567',
  memberOtherPhone: null,
  memberBranchCode: 'KS',
  copyBranchCode: 'KS',
  branchId: 1,
  borrowDate: '2026-10-01',
  dueDate: '2026-10-15',
  originalDueDate: '2026-10-15',
  returnedOn: null,
  status: 'open',
  overdue: true,
  daysLate: 3,
  isBackdated: false,
  returnBackdated: false,
  voidedAt: null,
  voidReason: null,
  extensionStatus: 'none',
  extensionRequestedAt: null,
  extensionDecidedAt: null,
  extensionReason: null,
  settlementId: null,
  ...over,
});

describe('endOfMonth', () => {
  it('finds the last day, leap years included', () => {
    expect(endOfMonth('2026-11-09')).toBe('2026-11-30');
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31');
    expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(endOfMonth('2027-02-15')).toBe('2027-02-28');
  });
});

describe('callList', () => {
  it('puts one line per member, the longest overdue first', () => {
    const list = callList([
      loan({ id: 1, memberId: 1, memberName: 'Nimali Silva', daysLate: 3 }),
      loan({ id: 2, memberId: 2, memberName: 'Ajith Perera', daysLate: 10 }),
      loan({ id: 3, memberId: 1, memberName: 'Nimali Silva', daysLate: 12 }),
      loan({ id: 4, memberId: 3, memberName: 'Chamari Dias', daysLate: 10 }),
    ]);
    expect(list.map((e) => [e.memberId, e.maxDaysLate])).toEqual([
      [1, 12],
      [2, 10],
      [3, 10],
    ]);
    expect(list[0]!.loans.map((l) => l.id)).toEqual([3, 1]);
  });

  it('is empty when nothing is overdue', () => {
    expect(callList([])).toEqual([]);
  });
});

describe('staffPanel', () => {
  const none: StaffCounts = {
    suspended: 0,
    overdue: 0,
    overdueMembers: 0,
    transit_overdue: 0,
    extensions_urgent: 0,
    due_today: 0,
    applications_waiting: 0,
    extensions_waiting: 0,
    requests_to_decide: 0,
    requests_to_send: 0,
    holds_lapsing: 0,
    requests_arriving: 0,
    copies_elsewhere: 0,
    due_soon: 0,
    returned_late_today: 0,
    lost_in_transit: 0,
    settlements_passed: 0,
    settlements_closing: 0,
    settlements_open: 0,
    expiring_this_month: 0,
  };

  it('shows only what needs attention, most urgent first', () => {
    const items = staffPanel({ ...none, due_soon: 4, overdue: 2, overdueMembers: 1, suspended: 1 });
    expect(items).toEqual([
      { kind: 'suspended', tone: 'urgent', count: 1 },
      { kind: 'overdue', tone: 'urgent', count: 2 },
      { kind: 'due_soon', tone: 'info', count: 4 },
    ]);
  });

  it('puts urgent extension requests after overdue books, and the rest after applications', () => {
    const items = staffPanel({
      ...none,
      overdue: 1,
      extensions_urgent: 1,
      due_today: 1,
      applications_waiting: 1,
      extensions_waiting: 3,
    });
    expect(items.map((i) => i.kind)).toEqual([
      'overdue',
      'extensions_urgent',
      'due_today',
      'applications_waiting',
      'extensions_waiting',
    ]);
    expect(items[1]!.tone).toBe('urgent');
  });

  it('puts a book lost on the road near the top, and the request steps after extensions', () => {
    const items = staffPanel({
      ...none,
      overdue: 1,
      transit_overdue: 1,
      extensions_waiting: 1,
      requests_to_decide: 1,
      copies_elsewhere: 1,
      due_soon: 1,
    });
    expect(items.map((i) => i.kind)).toEqual([
      'overdue',
      'transit_overdue',
      'extensions_waiting',
      'requests_to_decide',
      'copies_elsewhere',
      'due_soon',
    ]);
  });

  it('is empty on a quiet day', () => {
    expect(staffPanel(none)).toEqual([]);
  });
});
