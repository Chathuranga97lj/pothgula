import type { CopyState, IssueRefusal, IssueRefusalCode, LoanStanding } from '@pothgula/shared';
import type { UserRow } from '../auth/users';

/** Everything FR-CIR-02 needs to decide whether a copy may be issued to a member. */
export interface IssueFacts {
  /** `heldFor`: the member a held copy is waiting for (FR-REQ-05). */
  copy: { state: CopyState; branchId: number; heldFor?: number | null };
  member: Pick<UserRow, 'status' | 'expireAt' | 'branchId'> & { id?: number };
  /** The day the loan starts: today, or the real date of a back-dated paper loan. */
  borrowDate: string;
  standing: LoanStanding;
  /**
   * The member's open requests for books from other branches, not counting the
   * one this copy fulfils: each will become a book in hand (FR-CIR-06).
   */
  openRequests?: number;
}

/**
 * FR-CIR-02, FR-CIR-06, FR-MEM-04, FR-AUT-16, R21: every reason this copy
 * cannot go to this member, the book's first. An empty list means it may.
 *
 * M12 adds the one-book limit while a lost-book settlement is open.
 */
export function issueRefusals(f: IssueFacts): IssueRefusal[] {
  const refusals: IssueRefusal[] = [];
  const add = (code: IssueRefusalCode, params?: IssueRefusal['params']) =>
    refusals.push(params ? { code, params } : { code });

  // A copy held for this member is theirs to collect, though another branch owns it.
  const collecting =
    f.copy.state === 'held' && f.copy.heldFor != null && f.copy.heldFor === f.member.id;
  const copyRefusal: Partial<Record<CopyState, IssueRefusalCode>> = {
    on_loan: 'copy_on_loan',
    in_transit: 'copy_in_transit',
    held: 'copy_held',
    missing: 'copy_missing',
    not_useable: 'copy_not_useable',
    withdrawn: 'copy_withdrawn',
  };
  const fromCopy = collecting ? undefined : copyRefusal[f.copy.state];
  if (fromCopy) add(fromCopy);
  // A member borrows at their home branch only; other branches' books come by request.
  if (f.copy.branchId !== f.member.branchId && !collecting) add('copy_other_branch');

  switch (f.member.status) {
    case 'pending':
      add('member_pending');
      break;
    case 'suspended':
      add('member_suspended');
      break;
    case 'deactivated':
    case 'anonymised':
      add('member_deactivated');
      break;
    case 'rejected':
      add('member_rejected');
      break;
    case 'active':
      // Membership runs to the end of its expiry date (FR-MEM-04).
      if (!f.member.expireAt || f.member.expireAt < f.borrowDate) add('member_expired');
      break;
  }

  if (f.standing.overdueLoans > 0) add('member_overdue', { count: f.standing.overdueLoans });
  if (f.standing.openLoans + (f.openRequests ?? 0) >= f.standing.maxBooks) {
    add('member_at_limit', { max: f.standing.maxBooks });
  }
  return refusals;
}

/** Plain English fallbacks; the web app shows its own translations of the codes. */
export const REFUSAL_MESSAGES: Record<IssueRefusalCode, string> = {
  copy_on_loan: 'This copy is already on loan.',
  copy_in_transit: 'This copy is travelling between branches.',
  copy_held: 'This copy is held for another member.',
  copy_missing: 'This copy is recorded as missing.',
  copy_not_useable: 'This copy is recorded as not useable.',
  copy_withdrawn: 'This copy has been withdrawn.',
  copy_other_branch: 'This copy belongs to another branch; members borrow at their home branch.',
  member_pending: 'This application has not been approved yet.',
  member_suspended: 'This member is suspended.',
  member_deactivated: 'This account is deactivated.',
  member_rejected: 'This application was rejected.',
  member_expired: 'This membership has expired; the annual fee is due.',
  member_overdue: 'This member has an overdue book; it must come back first.',
  member_at_limit: 'This member already has as many books as allowed.',
};
