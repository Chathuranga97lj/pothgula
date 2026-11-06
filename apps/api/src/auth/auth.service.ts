import { Inject, Injectable } from '@nestjs/common';
import {
  type ChangePasswordRequest,
  type MeResponse,
  normalizePhone,
  type SignInRequest,
  type SignInResponse,
} from '@pothgula/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import type { Actor } from '../audit/actor';
import { UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { LOCKOUT_MS, MAX_FAILED_SIGNINS } from '../config';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { appUser } from '../db/schema';
import { type AuthContext, actorFor } from './auth-context';
import {
  assertAcceptablePassword,
  burnVerifyTime,
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from './passwords';
import { type SessionMeta, SessionService } from './session.service';
import { findUserById, findUserByPhone, toSessionUser, type UserRow } from './users';

const invalidCredentials = () =>
  AppError.unauthorized('invalid_credentials', 'That WhatsApp number and password do not match.');

const locked = (until: Date) =>
  AppError.unauthorized(
    'account_locked',
    'Too many failed attempts. Please wait before trying again.',
    { retryAfterSeconds: Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)) },
  );

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
  ) {}

  /** FR-AUT-02, FR-AUT-06, FR-AUT-17, FR-LOG-03. */
  async signIn(body: SignInRequest, meta: SessionMeta): Promise<SignInResponse> {
    const system: Actor = { kind: 'system', ipAddress: meta.ipAddress };
    const phone = normalizePhone(body.whatsappPhone);
    const user = phone ? await findUserByPhone(this.db, phone) : undefined;

    if (!user) {
      await burnVerifyTime(body.password);
      await this.uow.run(system, (_tx, log) =>
        log({
          action: 'auth.signin_failed',
          entity: 'app_user',
          after: {
            whatsappPhone: phone ?? body.whatsappPhone.slice(0, 32),
            reason: 'unknown_number',
          },
        }),
      );
      throw invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await burnVerifyTime(body.password);
      await this.uow.run(system, (_tx, log) =>
        log({
          action: 'auth.signin_failed',
          entity: 'app_user',
          entityId: user.id,
          branchId: user.branchId,
          after: { reason: 'locked' },
        }),
      );
      throw locked(user.lockedUntil);
    }

    if (!(await verifyPassword(user.passwordHash, body.password))) {
      const lockedUntil = await this.recordFailure(user, system);
      throw lockedUntil ? locked(lockedUntil) : invalidCredentials();
    }

    if (user.status === 'rejected' || user.status === 'deactivated') {
      await this.uow.run(system, (_tx, log) =>
        log({
          action: 'auth.signin_failed',
          entity: 'app_user',
          entityId: user.id,
          branchId: user.branchId,
          after: { reason: user.status },
        }),
      );
      throw user.status === 'rejected'
        ? AppError.forbidden(
            'application_rejected',
            'Your application was not approved. Please contact your branch.',
          )
        : AppError.forbidden(
            'account_deactivated',
            'This account has been deactivated. Please contact the library.',
          );
    }

    return this.uow.run(actorFor(user, meta.ipAddress), async (tx, log) => {
      if (user.failedSigninCount > 0 || user.lockedUntil) {
        await tx
          .update(appUser)
          .set({ failedSigninCount: 0, lockedUntil: null })
          .where(eq(appUser.id, user.id));
      }
      const token = await this.sessions.create(tx, user.id, meta);
      await log({ action: 'auth.signin', entity: 'app_user', entityId: user.id });
      return { token, user: toSessionUser(user) };
    });
  }

  /** Counts a wrong password; locks the account at the fifth (FR-AUT-06). */
  private recordFailure(user: UserRow, system: Actor): Promise<Date | null> {
    return this.uow.run(system, async (tx, log) => {
      const [row] = await tx
        .update(appUser)
        .set({ failedSigninCount: sql`${appUser.failedSigninCount} + 1` })
        .where(eq(appUser.id, user.id))
        .returning({ failed: appUser.failedSigninCount });
      const failed = row?.failed ?? 1;
      await log({
        action: 'auth.signin_failed',
        entity: 'app_user',
        entityId: user.id,
        branchId: user.branchId,
        after: { reason: 'wrong_password', attempt: failed },
      });
      if (failed < MAX_FAILED_SIGNINS) return null;

      const lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      await tx
        .update(appUser)
        .set({ failedSigninCount: 0, lockedUntil })
        .where(eq(appUser.id, user.id));
      await log({
        action: 'auth.locked',
        entity: 'app_user',
        entityId: user.id,
        branchId: user.branchId,
        after: { lockedUntil },
      });
      return lockedUntil;
    });
  }

  async signOut(ctx: AuthContext): Promise<void> {
    await this.uow.run(ctx.actor, async (tx, log) => {
      await this.sessions.revoke(tx, ctx.tokenHash);
      await log({ action: 'auth.signout', entity: 'app_user', entityId: ctx.user.id });
    });
  }

  /** FR-AUT-10: ends every other session of the account. */
  async changePassword(ctx: AuthContext, body: ChangePasswordRequest): Promise<void> {
    const user = await findUserById(this.db, ctx.user.id);
    if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw AppError.badRequest('wrong_current_password', 'Your current password is not correct.');
    }
    if (body.newPassword === body.currentPassword) {
      throw AppError.unprocessable('password_unchanged', 'The new password must be different.');
    }
    assertAcceptablePassword(body.newPassword, user.whatsappPhone);
    const passwordHash = await hashPassword(body.newPassword);

    await this.uow.run(ctx.actor, async (tx, log) => {
      await tx
        .update(appUser)
        .set({ passwordHash, mustChangePassword: false })
        .where(eq(appUser.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id, ctx.tokenHash);
      // FR-AUT-13: who and when — never the password or its hash.
      await log({
        action: 'auth.password_change',
        entity: 'app_user',
        entityId: user.id,
        before: { mustChangePassword: user.mustChangePassword },
        after: { mustChangePassword: false },
      });
    });
  }

  /**
   * FR-AUT-11, FR-AUT-12: a temporary password, shown once, which must be
   * replaced at the next sign-in. An admin may reset members and admins of their
   * own branch; a super admin anyone. Nobody resets their own this way.
   */
  async resetPassword(ctx: AuthContext, targetId: number): Promise<string> {
    const target = await findUserById(this.db, targetId);
    if (!target || target.status === 'anonymised') {
      throw AppError.notFound('user_not_found', 'No such account.');
    }
    assertMayResetPassword(ctx.user, target);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await this.uow.run(ctx.actor, async (tx, log) => {
      await tx
        .update(appUser)
        .set({ passwordHash, mustChangePassword: true, failedSigninCount: 0, lockedUntil: null })
        .where(eq(appUser.id, target.id));
      await this.sessions.revokeAllForUser(tx, target.id);
      await log({
        action: 'auth.password_reset',
        entity: 'app_user',
        entityId: target.id,
        branchId: target.branchId,
        after: { mustChangePassword: true },
      });
    });
    return temporaryPassword;
  }

  async me(ctx: AuthContext): Promise<MeResponse> {
    const warnings: MeResponse['warnings'] = [];
    if (ctx.user.userType === 'super_admin' && (await this.activeSuperAdminCount()) < 2) {
      warnings.push('fewer_than_two_super_admins'); // FR-AUT-14
    }
    return { user: toSessionUser(ctx.user), warnings };
  }

  private async activeSuperAdminCount(): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(appUser)
      .where(and(eq(appUser.userType, 'super_admin'), eq(appUser.status, 'active')));
    return row?.n ?? 0;
  }
}

export function assertMayResetPassword(actor: UserRow, target: UserRow): void {
  if (actor.id === target.id) {
    throw AppError.forbidden('use_change_password', 'Use "Change password" for your own account.');
  }
  if (actor.userType === 'super_admin') return;
  if (
    actor.userType === 'admin' &&
    target.userType !== 'super_admin' &&
    target.branchId === actor.branchId
  ) {
    return;
  }
  throw AppError.forbidden('forbidden', 'You cannot reset the password of this account.');
}
