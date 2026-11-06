/**
 * The two things done on the server itself, never through the website
 * (FR-AUT-04, FR-AUT-14): creating the very first super admin at installation,
 * and resetting a super admin's password when nobody else can.
 */
import { normalizePhone } from '@pothgula/shared';
import { and, eq } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../audit/actor';
import type { UnitOfWork } from '../audit/unit-of-work';
import { appUser, session } from '../db/schema';
import { generateTemporaryPassword, hashPassword } from './passwords';
import { loggableUser } from './users';

export class BootstrapError extends Error {
  override name = 'BootstrapError';
}

export async function createFirstSuperAdmin(
  uow: UnitOfWork,
  input: { fullName: string; whatsappPhone: string },
): Promise<{ userId: number; temporaryPassword: string }> {
  const fullName = input.fullName.trim();
  const whatsappPhone = normalizePhone(input.whatsappPhone);
  if (!fullName) throw new BootstrapError('A name is required.');
  if (!whatsappPhone) throw new BootstrapError(`Not a valid phone number: ${input.whatsappPhone}`);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return uow.run(SYSTEM_ACTOR, async (tx, log) => {
    // Serialise concurrent runs so two "first" super admins cannot both be created.
    await tx.execute('LOCK TABLE app_user IN SHARE ROW EXCLUSIVE MODE');
    const [existing] = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(eq(appUser.userType, 'super_admin'))
      .limit(1);
    if (existing) {
      throw new BootstrapError(
        'A super admin already exists. Further super admins are created inside the system.',
      );
    }
    const [row] = await tx
      .insert(appUser)
      .values({
        fullName,
        userType: 'super_admin',
        status: 'active',
        whatsappPhone,
        passwordHash,
        mustChangePassword: true,
        branchId: null,
      })
      .returning();
    if (!row) throw new Error('insert returned nothing');
    await log({
      action: 'super_admin.bootstrap',
      entity: 'app_user',
      entityId: row.id,
      branchId: null,
      after: loggableUser(row),
    });
    return { userId: row.id, temporaryPassword };
  });
}

export async function serverResetSuperAdmin(
  uow: UnitOfWork,
  input: { whatsappPhone: string },
): Promise<{ userId: number; temporaryPassword: string }> {
  const whatsappPhone = normalizePhone(input.whatsappPhone);
  if (!whatsappPhone) throw new BootstrapError(`Not a valid phone number: ${input.whatsappPhone}`);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return uow.run(SYSTEM_ACTOR, async (tx, log) => {
    const [target] = await tx
      .select()
      .from(appUser)
      .where(and(eq(appUser.whatsappPhone, whatsappPhone), eq(appUser.userType, 'super_admin')));
    if (!target) throw new BootstrapError(`No super admin uses ${whatsappPhone}.`);

    await tx
      .update(appUser)
      .set({
        passwordHash,
        mustChangePassword: true,
        failedSigninCount: 0,
        lockedUntil: null,
        status: 'active',
      })
      .where(eq(appUser.id, target.id));
    await tx.update(session).set({ revokedAt: new Date() }).where(eq(session.userId, target.id));
    await log({
      action: 'super_admin.server_reset',
      entity: 'app_user',
      entityId: target.id,
      branchId: null,
      before: { status: target.status },
      after: { status: 'active', mustChangePassword: true },
    });
    return { userId: target.id, temporaryPassword };
  });
}
