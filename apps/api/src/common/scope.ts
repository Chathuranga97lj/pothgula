import type { UserRow } from '../auth/users';
import { AppError } from './app-error';

/**
 * Branch scope (NFR-06): an admin acts on their own branch only; a super admin
 * on any. Checked in the service for every record touched, not only in the UI.
 */
export function assertBranchAccess(actor: UserRow, branchId: number | null): void {
  if (actor.userType === 'super_admin') return;
  if (actor.userType === 'admin' && branchId !== null && actor.branchId === branchId) return;
  throw AppError.forbidden('other_branch', 'This belongs to another branch.');
}

/** The branch an actor's lists are limited to, or null for every branch. */
export function branchScope(actor: UserRow): number | null {
  return actor.userType === 'super_admin' ? null : actor.branchId;
}
