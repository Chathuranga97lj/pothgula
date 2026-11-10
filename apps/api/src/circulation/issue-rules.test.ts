import { describe, expect, it } from 'vitest';
import { type IssueFacts, issueRefusals } from './issue-rules';

const facts = (over: Partial<IssueFacts> = {}): IssueFacts => ({
  copy: { state: 'on_shelf', branchId: 1 },
  member: { status: 'active', expireAt: '2027-01-01', branchId: 1 },
  borrowDate: '2026-11-09',
  standing: {
    openLoans: 0,
    maxBooks: 2,
    overdueLoans: 0,
    lateReturns: 0,
    lateReturnMonths: 12,
    frequentlyLate: false,
  },
  ...over,
});
const codes = (f: IssueFacts) => issueRefusals(f).map((r) => r.code);

describe('who may borrow what (FR-CIR-02)', () => {
  it('lets an active member take a copy from their home branch shelf', () => {
    expect(issueRefusals(facts())).toEqual([]);
  });

  it('refuses a copy that is not on the shelf, or belongs elsewhere', () => {
    expect(codes(facts({ copy: { state: 'on_loan', branchId: 1 } }))).toEqual(['copy_on_loan']);
    expect(codes(facts({ copy: { state: 'withdrawn', branchId: 1 } }))).toEqual(['copy_withdrawn']);
    expect(codes(facts({ copy: { state: 'missing', branchId: 1 } }))).toEqual(['copy_missing']);
    expect(codes(facts({ copy: { state: 'not_useable', branchId: 1 } }))).toEqual([
      'copy_not_useable',
    ]);
    expect(codes(facts({ copy: { state: 'on_shelf', branchId: 2 } }))).toEqual([
      'copy_other_branch',
    ]);
  });

  it('refuses applicants, suspended, deactivated and expired members', () => {
    const as = (status: IssueFacts['member']['status'], expireAt: string | null = '2027-01-01') =>
      codes(facts({ member: { status, expireAt, branchId: 1 } }));
    expect(as('pending', null)).toEqual(['member_pending']);
    expect(as('suspended')).toEqual(['member_suspended']);
    expect(as('deactivated')).toEqual(['member_deactivated']);
    expect(as('rejected', null)).toEqual(['member_rejected']);
    expect(as('active', '2026-11-08')).toEqual(['member_expired']);
    expect(as('active', null)).toEqual(['member_expired']);
  });

  it('counts the expiry day itself as still a member', () => {
    expect(
      codes(facts({ member: { status: 'active', expireAt: '2026-11-09', branchId: 1 } })),
    ).toEqual([]);
  });

  it('blocks a member holding an overdue book (R21), and one at the limit (FR-CIR-06)', () => {
    const standing = { ...facts().standing, openLoans: 2, overdueLoans: 1 };
    expect(issueRefusals(facts({ standing }))).toEqual([
      { code: 'member_overdue', params: { count: 1 } },
      { code: 'member_at_limit', params: { max: 2 } },
    ]);
  });

  it('gives every reason at once, the book first', () => {
    expect(
      codes(
        facts({
          copy: { state: 'on_loan', branchId: 2 },
          member: { status: 'active', expireAt: '2026-01-01', branchId: 1 },
        }),
      ),
    ).toEqual(['copy_on_loan', 'copy_other_branch', 'member_expired']);
  });
});

describe('copies travelling for other-branch requests (FR-REQ-04, FR-REQ-05)', () => {
  it('refuses a copy in transit, or held for someone else', () => {
    expect(codes(facts({ copy: { state: 'in_transit', branchId: 1 } }))).toEqual([
      'copy_in_transit',
    ]);
    expect(codes(facts({ copy: { state: 'held', branchId: 1, heldFor: 99 } }))).toEqual([
      'copy_held',
    ]);
  });

  it('lets the member collect the copy held for them, though another branch owns it', () => {
    const f = facts({
      copy: { state: 'held', branchId: 2, heldFor: 7 },
      member: { id: 7, status: 'active', expireAt: '2027-01-01', branchId: 1 },
    });
    expect(issueRefusals(f)).toEqual([]);
  });

  it('counts open requests towards the limit (FR-CIR-06)', () => {
    const one = { ...facts().standing, openLoans: 1 };
    expect(codes(facts({ standing: one, openRequests: 1 }))).toEqual(['member_at_limit']);
    expect(codes(facts({ standing: one, openRequests: 0 }))).toEqual([]);
  });

  it('allows one book while a lost-book settlement is open (FR-LST-04)', () => {
    const none = facts({ settlingMaxBooks: 1 });
    expect(codes(none)).toEqual([]);
    const one = facts({ standing: { ...facts().standing, openLoans: 1 }, settlingMaxBooks: 1 });
    expect(issueRefusals(one)).toEqual([{ code: 'member_settling', params: { max: 1 } }]);
    // A setting no lower than the normal limit changes nothing.
    const same = facts({ standing: { ...facts().standing, openLoans: 2 }, settlingMaxBooks: 2 });
    expect(codes(same)).toEqual(['member_at_limit']);
  });
});
