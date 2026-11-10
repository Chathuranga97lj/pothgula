import { describe, expect, it } from 'vitest';
import { accessionInputSchema, daysLate, isOverdue, loanStanding } from './circulation.js';

const today = '2026-11-09';

describe('days late (FR-CIR-04)', () => {
  it('counts from the due date to the return, or to today while out', () => {
    expect(daysLate({ dueDate: '2026-11-09', returnedOn: null }, today)).toBe(0);
    expect(daysLate({ dueDate: '2026-11-06', returnedOn: null }, today)).toBe(3);
    expect(daysLate({ dueDate: '2026-11-01', returnedOn: '2026-11-04' }, today)).toBe(3);
    expect(daysLate({ dueDate: '2026-11-01', returnedOn: '2026-11-01' }, today)).toBe(0);
    expect(daysLate({ dueDate: '2026-11-01', returnedOn: '2026-10-25' }, today)).toBe(0);
  });

  it('never counts a voided loan', () => {
    expect(daysLate({ dueDate: '2026-10-01', returnedOn: null, voided: true }, today)).toBe(0);
    expect(isOverdue({ dueDate: '2026-10-01', returnedOn: null, voided: true }, today)).toBe(false);
  });

  it('is overdue only once the due date has passed', () => {
    expect(isOverdue({ dueDate: today, returnedOn: null }, today)).toBe(false);
    expect(isOverdue({ dueDate: '2026-11-08', returnedOn: null }, today)).toBe(true);
    expect(isOverdue({ dueDate: '2026-11-08', returnedOn: '2026-11-09' }, today)).toBe(false);
  });
});

describe('loan standing (FR-CIR-06, FR-CIR-15)', () => {
  const rules = { maxBooks: 2, frequentLateCount: 3, frequentLateMonths: 12 };
  const late = (returnedOn: string) => ({ dueDate: '2000-01-01', returnedOn, voided: false });

  it('marks three late returns within twelve months as frequently late', () => {
    const loans = [late('2026-01-10'), late('2026-05-01'), late('2026-11-01')];
    expect(loanStanding(loans, today, rules)).toMatchObject({
      lateReturns: 3,
      frequentlyLate: true,
    });
  });

  it('forgets late returns older than the period, and voided loans', () => {
    const loans = [
      late('2025-11-09'),
      late('2026-05-01'),
      { ...late('2026-06-01'), voided: true },
      late('2026-11-01'),
    ];
    expect(loanStanding(loans, today, rules)).toMatchObject({
      lateReturns: 2,
      frequentlyLate: false,
    });
  });

  it('counts books still out, and those overdue', () => {
    const loans = [
      { dueDate: '2026-11-20', returnedOn: null, voided: false },
      { dueDate: '2026-11-01', returnedOn: null, voided: false },
      { dueDate: '2026-10-01', returnedOn: null, voided: true },
    ];
    expect(loanStanding(loans, today, rules)).toMatchObject({
      openLoans: 2,
      overdueLoans: 1,
      maxBooks: 2,
    });
  });
});

describe('accession input', () => {
  it('accepts what staff type and gives the printed form', () => {
    expect(accessionInputSchema.parse('ks-a1-01234')).toBe('KS-A1-01234');
    expect(accessionInputSchema.parse('KSA101234')).toBe('KS-A1-01234');
    expect(accessionInputSchema.safeParse('KS-A1').success).toBe(false);
  });
});

describe('an extension request waiting (FR-CIR-13)', () => {
  const waiting = {
    dueDate: '2026-11-01',
    returnedOn: null,
    extensionStatus: 'requested' as const,
  };

  it('keeps the loan from being overdue or late while it waits', () => {
    expect(isOverdue(waiting, today)).toBe(false);
    expect(daysLate(waiting, today)).toBe(0);
    expect(daysLate({ ...waiting, returnedOn: '2026-11-05' }, today)).toBe(0);
  });

  it('protects nothing once decided', () => {
    for (const extensionStatus of ['none', 'approved', 'declined'] as const) {
      expect(isOverdue({ ...waiting, extensionStatus }, today)).toBe(true);
      expect(daysLate({ ...waiting, extensionStatus }, today)).toBe(8);
    }
  });

  it('is not counted as a late return in the standing', () => {
    const s = loanStanding([{ ...waiting, returnedOn: '2026-11-05', voided: false }], today, {
      maxBooks: 2,
      frequentLateCount: 1,
      frequentLateMonths: 12,
    });
    expect(s).toMatchObject({ lateReturns: 0, overdueLoans: 0 });
  });
});
