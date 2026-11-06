import type { SessionUser, StaffMember } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import type { Queryable } from '../db/client';
import { appUser } from '../db/schema';

export type UserRow = typeof appUser.$inferSelect;

export async function findUserById(q: Queryable, id: number): Promise<UserRow | undefined> {
  const [row] = await q.select().from(appUser).where(eq(appUser.id, id));
  return row;
}

export async function findUserByPhone(q: Queryable, phone: string): Promise<UserRow | undefined> {
  const [row] = await q.select().from(appUser).where(eq(appUser.whatsappPhone, phone));
  return row;
}

/**
 * A user row as it may appear in the activity log: the password hash and the
 * sign-in counters are left out. Nothing that can recover a password is ever logged.
 */
export function loggableUser(row: UserRow) {
  const { passwordHash: _hash, failedSigninCount: _count, lockedUntil: _locked, ...rest } = row;
  return rest;
}

export function toSessionUser(row: UserRow): SessionUser {
  if (row.whatsappPhone === null) throw new Error('An anonymised account cannot sign in');
  return {
    id: row.id,
    fullName: row.fullName,
    userType: row.userType,
    status: row.status,
    branchId: row.branchId,
    whatsappPhone: row.whatsappPhone,
    mustChangePassword: row.mustChangePassword,
  };
}

export function toStaffMember(row: UserRow): StaffMember {
  if (row.userType === 'member') throw new Error('Not a staff account');
  return {
    id: row.id,
    fullName: row.fullName,
    userType: row.userType,
    status: row.status,
    branchId: row.branchId,
    whatsappPhone: row.whatsappPhone,
    mustChangePassword: row.mustChangePassword,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
  };
}
