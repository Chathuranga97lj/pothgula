import {
  addDays,
  ageOn,
  areaOf,
  type MemberDetail,
  type MembershipPayment,
  type MembershipState,
  type MemberSummary,
} from '@pothgula/shared';
import type { UserRow } from '../auth/users';
import type { membershipPayment } from '../db/schema';

/** Where a membership stands today. Expiry is worked out from the date (R2). */
export function membershipState(row: UserRow, today: string): MembershipState {
  switch (row.status) {
    case 'active':
      return row.expireAt && row.expireAt >= today ? 'active' : 'expired';
    default:
      return row.status;
  }
}

export function toMemberSummary(row: UserRow, today: string, staleDays: number): MemberSummary {
  const appliedOn = row.appliedAt?.toISOString().slice(0, 10) ?? null;
  return {
    id: row.id,
    fullName: row.fullName,
    whatsappPhone: row.whatsappPhone,
    branchId: row.branchId,
    status: row.status,
    state: membershipState(row, today),
    age: row.dateOfBirth ? ageOn(row.dateOfBirth, today) : null,
    area: areaOf(row.address),
    organisation: row.organisation,
    introducedByName: row.introducedByName,
    introducedByPhone: row.introducedByPhone,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    expireAt: row.expireAt,
    stale: row.status === 'pending' && appliedOn !== null && addDays(appliedOn, staleDays) < today,
  };
}

export function toPayment(row: typeof membershipPayment.$inferSelect): MembershipPayment {
  return {
    id: row.id,
    kind: row.kind,
    amountCents: row.amountCents,
    paidOn: row.paidOn,
    receiptNo: row.receiptNo,
    reason: row.reason,
    extendsTo: row.extendsTo,
    collectedBy: row.collectedBy,
    reversesPaymentId: row.reversesPaymentId,
  };
}

export function toMemberDetail(
  row: UserRow,
  payments: (typeof membershipPayment.$inferSelect)[],
  today: string,
  staleDays: number,
): MemberDetail {
  return {
    ...toMemberSummary(row, today, staleDays),
    address: row.address,
    otherPhone: row.otherPhone,
    dateOfBirth: row.dateOfBirth,
    rejectionReason: row.rejectionReason,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    mustChangePassword: row.mustChangePassword,
    payments: payments.map(toPayment),
  };
}
