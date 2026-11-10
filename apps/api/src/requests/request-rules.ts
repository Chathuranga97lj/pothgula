import type { IssueRefusalCode, LoanStanding, RequestRefusalCode } from '@pothgula/shared';
import type { UserRow } from '../auth/users';
import { issueRefusals } from '../circulation/issue-rules';

export type RequestRefusal = RequestRefusalCode | IssueRefusalCode;

export interface RequestFacts {
  member: Pick<UserRow, 'id' | 'status' | 'expireAt' | 'branchId'>;
  fromBranchId: number;
  /** Copies of the title on the shelf at that branch now. */
  shelfCopies: number;
  standing: LoanStanding;
  /** The member's open requests, not counting the one being decided. */
  openRequests: number;
  today: string;
}

/**
 * FR-REQ-01, FR-REQ-02: every reason a member cannot have this request, in the
 * order they are explained. The member must be able to be issued a book right
 * now (FR-CIR-02, the limit of FR-CIR-06 counting open requests) and may have
 * one request open at a time. Checked when they ask, and again when the
 * holding branch accepts.
 */
export function requestRefusals(f: RequestFacts): RequestRefusal[] {
  const refusals: RequestRefusal[] = [];
  if (f.fromBranchId === f.member.branchId) refusals.push('own_branch');
  if (f.shelfCopies === 0) refusals.push('none_on_shelf');
  if (f.openRequests > 0) refusals.push('request_open');
  // The member's side of FR-CIR-02, as if a copy from their own shelf were being issued.
  const asIfIssued = issueRefusals({
    copy: { state: 'on_shelf', branchId: f.member.branchId ?? -1 },
    member: f.member,
    borrowDate: f.today,
    standing: f.standing,
    openRequests: f.openRequests,
  });
  for (const r of asIfIssued) {
    if (r.code.startsWith('member_')) refusals.push(r.code);
  }
  return refusals;
}

/** Plain English fallbacks; the web app shows its own translations of the codes. */
export const REQUEST_MESSAGES: Record<RequestRefusalCode, string> = {
  request_open: 'The member already has a request open; one at a time.',
  own_branch: 'This is the member’s own branch; borrow it at the counter.',
  none_on_shelf: 'That branch has no copy of this book on the shelf now.',
  request_not_found: 'No such request.',
  wrong_step: 'The request is not at that step.',
  copy_not_on_shelf: 'That copy is not on the shelf to send.',
  hold_not_over: 'The hold has not ended yet.',
};
