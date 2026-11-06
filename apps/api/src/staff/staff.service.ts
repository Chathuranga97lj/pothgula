import { Inject, Injectable } from '@nestjs/common';
import type { CreateStaffRequest, StaffMember } from '@pothgula/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { UnitOfWork } from '../audit/unit-of-work';
import type { AuthContext } from '../auth/auth-context';
import { generateTemporaryPassword, hashPassword } from '../auth/passwords';
import { SessionService } from '../auth/session.service';
import { findUserById, findUserByPhone, loggableUser, toStaffMember } from '../auth/users';
import { AppError } from '../common/app-error';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, branch } from '../db/schema';

/** FR-AUT-14: the system never lets the number of active super admins fall below this. */
const MIN_SUPER_ADMINS = 2;

@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
  ) {}

  /** Super admins see every staff account; an admin sees the admins of their own branch. */
  async list(ctx: AuthContext): Promise<StaffMember[]> {
    const staffTypes = inArray(appUser.userType, ['admin', 'super_admin']);
    const where =
      ctx.user.userType === 'super_admin'
        ? staffTypes
        : and(eq(appUser.userType, 'admin'), eq(appUser.branchId, ctx.user.branchId ?? -1));
    const rows = await this.db
      .select()
      .from(appUser)
      .where(where)
      .orderBy(asc(appUser.userType), asc(appUser.fullName));
    return rows.map(toStaffMember);
  }

  /**
   * FR-AUT-04, FR-AUT-05: only a super admin creates staff — admins for a branch,
   * or further super admins. The new account starts with a temporary password.
   */
  async create(
    ctx: AuthContext,
    body: CreateStaffRequest,
  ): Promise<{ user: StaffMember; temporaryPassword: string }> {
    if (await findUserByPhone(this.db, body.whatsappPhone)) {
      throw AppError.conflict('phone_in_use', 'An account already uses this WhatsApp number.');
    }
    if (body.branchId !== null) {
      const [exists] = await this.db
        .select({ id: branch.id })
        .from(branch)
        .where(eq(branch.id, body.branchId));
      if (!exists) throw AppError.badRequest('branch_not_found', 'No such branch.');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const created = await this.uow.run(ctx.actor, async (tx, log) => {
      const [row] = await tx
        .insert(appUser)
        .values({
          fullName: body.fullName,
          userType: body.userType,
          status: 'active',
          whatsappPhone: body.whatsappPhone,
          passwordHash,
          mustChangePassword: true,
          branchId: body.branchId,
        })
        .returning();
      if (!row) throw new Error('insert returned nothing');
      await log({
        action: 'staff.create',
        entity: 'app_user',
        entityId: row.id,
        branchId: row.branchId,
        after: loggableUser(row),
      });
      return row;
    });
    return { user: toStaffMember(created), temporaryPassword };
  }

  /**
   * FR-AUT-09: a super admin deactivates an account; it is never deleted and its
   * sessions end at once. FR-AUT-14: never below two active super admins.
   */
  async deactivate(ctx: AuthContext, targetId: number, reason: string): Promise<void> {
    const target = await findUserById(this.db, targetId);
    if (!target || target.status === 'anonymised') {
      throw AppError.notFound('user_not_found', 'No such account.');
    }
    if (target.id === ctx.user.id) {
      throw AppError.forbidden('cannot_deactivate_self', 'You cannot deactivate your own account.');
    }
    if (target.status === 'deactivated') {
      throw AppError.conflict('already_deactivated', 'This account is already deactivated.');
    }

    await this.uow.run(ctx.actor, async (tx, log) => {
      if (target.userType === 'super_admin') {
        // Lock the super admin rows so two simultaneous deactivations cannot both pass.
        const active = await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(and(eq(appUser.userType, 'super_admin'), eq(appUser.status, 'active')))
          .for('update');
        if (active.length <= MIN_SUPER_ADMINS) {
          throw AppError.conflict(
            'minimum_super_admins',
            'At least two super admin accounts must stay active.',
          );
        }
      }
      await tx.update(appUser).set({ status: 'deactivated' }).where(eq(appUser.id, target.id));
      await this.sessions.revokeAllForUser(tx, target.id);
      await log({
        action: 'account.deactivate',
        entity: 'app_user',
        entityId: target.id,
        branchId: target.branchId,
        before: { status: target.status },
        after: { status: 'deactivated', reason },
      });
    });
  }

  /** Undoes a staff deactivation. (Members return through the membership screens, M4.) */
  async reactivate(ctx: AuthContext, targetId: number): Promise<void> {
    const target = await findUserById(this.db, targetId);
    if (!target || target.userType === 'member') {
      throw AppError.notFound('user_not_found', 'No such staff account.');
    }
    if (target.status !== 'deactivated') {
      throw AppError.conflict('not_deactivated', 'This account is not deactivated.');
    }
    await this.uow.run(ctx.actor, async (tx, log) => {
      await tx.update(appUser).set({ status: 'active' }).where(eq(appUser.id, target.id));
      await log({
        action: 'account.reactivate',
        entity: 'app_user',
        entityId: target.id,
        branchId: target.branchId,
        before: { status: 'deactivated' },
        after: { status: 'active' },
      });
    });
  }
}
