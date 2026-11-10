import { describe, expect, it } from 'vitest';
import { type RequestFacts, requestRefusals } from './request-rules';

const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  member: { id: 7, status: 'active', expireAt: '2027-01-01', branchId: 1 },
  fromBranchId: 2,
  shelfCopies: 1,
  standing: {
    openLoans: 0,
    maxBooks: 2,
    overdueLoans: 0,
    lateReturns: 0,
    lateReturnMonths: 12,
    frequentlyLate: false,
  },
  openRequests: 0,
  today: '2026-11-10',
  ...over,
});

describe('who may ask for a book from another branch (FR-REQ-01, FR-REQ-02)', () => {
  it('lets a member who could borrow now ask for a copy on another branch’s shelf', () => {
    expect(requestRefusals(facts())).toEqual([]);
  });

  it('refuses their own branch, an empty shelf, and a second request', () => {
    expect(requestRefusals(facts({ fromBranchId: 1 }))).toEqual(['own_branch']);
    expect(requestRefusals(facts({ shelfCopies: 0 }))).toEqual(['none_on_shelf']);
    expect(requestRefusals(facts({ openRequests: 1 }))).toEqual(['request_open']);
  });

  it('refuses whoever could not be issued a book now, with the counter’s reasons', () => {
    const m = (status: string, expireAt: string | null = '2027-01-01') =>
      requestRefusals(facts({ member: { id: 7, status: status as never, expireAt, branchId: 1 } }));
    expect(m('pending', null)).toEqual(['member_pending']);
    expect(m('suspended')).toEqual(['member_suspended']);
    expect(m('active', '2026-11-01')).toEqual(['member_expired']);
    const full = { ...facts().standing, openLoans: 2 };
    expect(requestRefusals(facts({ standing: full }))).toEqual(['member_at_limit']);
    const late = { ...facts().standing, openLoans: 1, overdueLoans: 1 };
    expect(requestRefusals(facts({ standing: late }))).toEqual(['member_overdue']);
  });

  it('counts the open request towards the limit too', () => {
    const one = { ...facts().standing, openLoans: 1 };
    expect(requestRefusals(facts({ standing: one, openRequests: 1 }))).toEqual([
      'request_open',
      'member_at_limit',
    ]);
  });
});
