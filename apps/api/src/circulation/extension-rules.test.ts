import { describe, expect, it } from 'vitest';
import { type ExtensionFacts, extensionRefusals } from './extension-rules';

const today = '2026-11-10';
const facts = (
  over: Omit<Partial<ExtensionFacts>, 'loan'> & { loan?: Partial<ExtensionFacts['loan']> },
): ExtensionFacts => ({
  action: 'request' as const,
  memberStatus: 'active',
  otherOverdue: 0,
  today,
  ...over,
  loan: {
    returnedOn: null,
    voided: false,
    dueDate: '2026-11-15',
    extensionStatus: 'none' as const,
    ...over.loan,
  },
});

describe('extension rules (FR-CIR-10, FR-CIR-11, FR-CIR-13)', () => {
  it('lets a member ask once, up to and including the due date', () => {
    expect(extensionRefusals(facts({}))).toEqual([]);
    expect(extensionRefusals(facts({ loan: { dueDate: today } }))).toEqual([]);
    expect(extensionRefusals(facts({ loan: { dueDate: '2026-11-09' } }))).toEqual(['loan_overdue']);
    expect(extensionRefusals(facts({ loan: { extensionStatus: 'requested' } }))).toEqual([
      'extension_requested',
    ]);
    expect(extensionRefusals(facts({ loan: { extensionStatus: 'approved' } }))).toEqual([
      'extension_used',
    ]);
    expect(extensionRefusals(facts({ loan: { extensionStatus: 'declined' } }))).toEqual([
      'extension_used',
    ]);
  });

  it('refuses a suspended member, or one holding another overdue book, and says every reason', () => {
    expect(
      extensionRefusals(
        facts({ memberStatus: 'suspended', otherOverdue: 1, loan: { dueDate: '2026-11-01' } }),
      ),
    ).toEqual(['loan_overdue', 'member_suspended', 'other_book_overdue']);
  });

  it('lets staff grant one directly after a decline, but not over a request waiting', () => {
    expect(
      extensionRefusals(facts({ action: 'grant', loan: { extensionStatus: 'declined' } })),
    ).toEqual([]);
    expect(
      extensionRefusals(facts({ action: 'grant', loan: { extensionStatus: 'requested' } })),
    ).toEqual(['extension_requested']);
    expect(
      extensionRefusals(facts({ action: 'grant', loan: { extensionStatus: 'approved' } })),
    ).toEqual(['extension_used']);
  });

  it('approves a request made in time even after the due date, under the member rules', () => {
    const waiting = { extensionStatus: 'requested' as const, dueDate: '2026-11-01' };
    expect(extensionRefusals(facts({ action: 'approve', loan: waiting }))).toEqual([]);
    expect(extensionRefusals(facts({ action: 'approve', loan: waiting, otherOverdue: 2 }))).toEqual(
      ['other_book_overdue'],
    );
    expect(extensionRefusals(facts({ action: 'approve' }))).toEqual(['no_extension_request']);
  });

  it('declines or withdraws only a request waiting, whatever else is true', () => {
    const waiting = { extensionStatus: 'requested' as const };
    for (const action of ['decline', 'cancel'] as const) {
      expect(
        extensionRefusals(
          facts({ action, memberStatus: 'suspended', otherOverdue: 1, loan: waiting }),
        ),
      ).toEqual([]);
      expect(extensionRefusals(facts({ action }))).toEqual(['no_extension_request']);
    }
  });

  it('does nothing with a loan that is back or void', () => {
    expect(extensionRefusals(facts({ loan: { returnedOn: '2026-11-09' } }))).toEqual([
      'loan_not_open',
    ]);
    expect(extensionRefusals(facts({ action: 'approve', loan: { voided: true } }))).toEqual([
      'loan_not_open',
    ]);
  });
});
