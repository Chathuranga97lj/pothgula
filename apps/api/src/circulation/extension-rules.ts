import type { ExtensionRefusalCode, ExtensionStatus } from '@pothgula/shared';

/**
 * What is being done with a loan's one extension: a member asks for it or
 * withdraws the request; staff grant it directly, or approve or decline a request.
 */
export type ExtensionAction = 'request' | 'cancel' | 'grant' | 'approve' | 'decline';

export interface ExtensionFacts {
  action: ExtensionAction;
  loan: {
    returnedOn: string | null;
    voided: boolean;
    dueDate: string;
    extensionStatus: ExtensionStatus;
  };
  memberStatus: string;
  /** The member's other loans that are overdue today. */
  otherOverdue: number;
  today: string;
}

/**
 * FR-CIR-10, FR-CIR-11, FR-CIR-13: every reason this cannot be done, in the
 * order they are explained. An empty list means it may.
 *
 * - One extension per loan. A member asks once; staff may still grant one
 *   directly after a decline, which is the same decision made again in person.
 * - Asking or granting is refused once the loan is overdue: a request can only
 *   be made up to and including the due date.
 * - Approving a request made in time is allowed after the due date has passed;
 *   the request protected the loan meanwhile.
 * - Declining and withdrawing need only a request waiting.
 */
export function extensionRefusals(f: ExtensionFacts): ExtensionRefusalCode[] {
  if (f.loan.voided || f.loan.returnedOn !== null) return ['loan_not_open'];
  const refusals: ExtensionRefusalCode[] = [];
  const status = f.loan.extensionStatus;

  switch (f.action) {
    case 'request':
      if (status === 'requested') refusals.push('extension_requested');
      if (status === 'approved' || status === 'declined') refusals.push('extension_used');
      break;
    case 'grant':
      if (status === 'requested') refusals.push('extension_requested');
      if (status === 'approved') refusals.push('extension_used');
      break;
    case 'approve':
    case 'decline':
    case 'cancel':
      if (status !== 'requested') refusals.push('no_extension_request');
      break;
  }

  if ((f.action === 'request' || f.action === 'grant') && f.loan.dueDate < f.today) {
    refusals.push('loan_overdue');
  }
  if (f.action === 'request' || f.action === 'grant' || f.action === 'approve') {
    if (f.memberStatus === 'suspended') refusals.push('member_suspended');
    if (f.otherOverdue > 0) refusals.push('other_book_overdue');
  }
  return refusals;
}

/** Plain English fallbacks; the web app shows its own translations of the codes. */
export const EXTENSION_MESSAGES: Record<ExtensionRefusalCode, string> = {
  loan_not_open: 'This book is not out on loan.',
  extension_requested: 'An extension has already been requested for this loan.',
  extension_used: 'This loan has already had its one extension.',
  no_extension_request: 'There is no extension request waiting on this loan.',
  loan_overdue: 'This book is already overdue; it can no longer be extended.',
  member_suspended: 'The member is suspended.',
  other_book_overdue: 'The member holds another book that is overdue.',
};
