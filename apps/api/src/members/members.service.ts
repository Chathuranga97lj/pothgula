import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  addYears,
  applicationRequestSchema,
  type ApproveRequest,
  type FirstPayment,
  type MemberDetail,
  type MembershipOverview,
  type MemberSummary,
  normalizePhone,
  registerMemberRequestSchema,
  renewedExpiry,
  type RenewRequest,
  todayColombo,
  type UpdateApplicationRequest,
  type UpdateProfileRequest,
} from '@pothgula/shared';
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { actorFor, type AuthContext } from '../auth/auth-context';
import {
  assertAcceptablePassword,
  generateTemporaryPassword,
  hashPassword,
} from '../auth/passwords';
import { SessionService } from '../auth/session.service';
import { findUserById, findUserByPhone, loggableUser, type UserRow } from '../auth/users';
import { type Log, UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { assertBranchAccess, branchScope } from '../common/scope';
import type { Db, Queryable, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, branch, branchSetting, membershipPayment } from '../db/schema';
import { toMemberDetail, toMemberSummary } from './member-view';

type ParsedApplication = z.output<typeof applicationRequestSchema>;
type ParsedRegistration = z.output<typeof registerMemberRequestSchema>;

const phoneInUse = () =>
  AppError.conflict('phone_in_use', 'An account already uses this WhatsApp number.');

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
  ) {}

  // ─── Applying (public) ─────────────────────────────────────────────────────

  /** FR-AUT-03: creates an account in the pending state — not a membership. */
  async apply(body: ParsedApplication, ipAddress: string | null): Promise<{ userId: number }> {
    if (await findUserByPhone(this.db, body.whatsappPhone)) throw phoneInUse();
    await this.assertBranchExists(this.db, body.homeBranchId);
    assertAcceptablePassword(body.password, body.whatsappPhone);
    this.assertPastDate(body.dateOfBirth);
    const passwordHash = await hashPassword(body.password);

    return this.uow.runAs(async (tx, logAs) => {
      const [row] = await tx
        .insert(appUser)
        .values({
          ...personValues(body),
          whatsappPhone: body.whatsappPhone,
          userType: 'member',
          status: 'pending',
          passwordHash,
          introducerConsent: true,
          appliedAt: new Date(),
        })
        .returning();
      if (!row) throw new Error('insert returned nothing');
      // The applicant is the actor: their own account now exists in this transaction.
      await logAs(actorFor(row, ipAddress), {
        action: 'application.create',
        entity: 'app_user',
        entityId: row.id,
        branchId: row.branchId,
        after: loggableUser(row),
      });
      return { userId: row.id };
    });
  }

  // ─── The applicant or member themselves ────────────────────────────────────

  async ownRecord(ctx: AuthContext): Promise<MemberDetail> {
    if (ctx.user.userType !== 'member') {
      throw AppError.forbidden('members_only', 'Only members have a membership record.');
    }
    return this.detailOf(this.db, ctx.user);
  }

  /** FR-AUT-21: an applicant corrects their application while it is pending. */
  async updateOwnApplication(
    ctx: AuthContext,
    body: UpdateApplicationRequest,
  ): Promise<MemberDetail> {
    if (ctx.user.userType !== 'member' || ctx.user.status !== 'pending') {
      throw AppError.forbidden('not_pending', 'Only an application still waiting can be changed.');
    }
    const parsed = body as unknown as ParsedApplication;
    await this.assertBranchExists(this.db, parsed.homeBranchId);
    this.assertPastDate(parsed.dateOfBirth);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [after] = await tx
        .update(appUser)
        .set(personValues(parsed))
        .where(eq(appUser.id, ctx.user.id))
        .returning();
      await log({
        action: 'application.update',
        entity: 'app_user',
        entityId: ctx.user.id,
        branchId: after!.branchId,
        before: loggableUser(ctx.user),
        after: loggableUser(after!),
      });
      return this.detailOf(tx, after!);
    });
  }

  /** FR-AUT-21: a member changes their address, other phone and organisation. */
  async updateOwnProfile(ctx: AuthContext, body: UpdateProfileRequest): Promise<MemberDetail> {
    if (ctx.user.userType !== 'member' || !['active', 'suspended'].includes(ctx.user.status)) {
      throw AppError.forbidden('members_only', 'Only members can change their details here.');
    }
    const changes = body as {
      address?: string;
      otherPhone?: string | null;
      organisation?: string | null;
    };
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [after] = await tx
        .update(appUser)
        .set(changes)
        .where(eq(appUser.id, ctx.user.id))
        .returning();
      await log({
        action: 'member.update_own',
        entity: 'app_user',
        entityId: ctx.user.id,
        before: pick(loggableUser(ctx.user), Object.keys(changes)),
        after: pick(loggableUser(after!), Object.keys(changes)),
      });
      return this.detailOf(tx, after!);
    });
  }

  // ─── Staff: applications (FR-AUT-17, FR-AUT-18) ────────────────────────────

  /** The waiting list, oldest first; or rejected ones, to reopen. */
  async applications(ctx: AuthContext, status: 'pending' | 'rejected'): Promise<MemberSummary[]> {
    const scope = branchScope(ctx.user);
    const rows = await this.db
      .select({ user: appUser, staleDays: branchSetting.applicationStaleDays })
      .from(appUser)
      .innerJoin(branchSetting, eq(branchSetting.branchId, appUser.branchId))
      .where(
        and(
          eq(appUser.userType, 'member'),
          eq(appUser.status, status),
          scope === null ? undefined : eq(appUser.branchId, scope),
        ),
      )
      .orderBy(asc(appUser.appliedAt));
    const today = todayColombo();
    return rows.map((r) => toMemberSummary(r.user, today, r.staleDays));
  }

  /**
   * FR-AUT-17, FR-MEM-10, R18: approval at the counter. The applicant's identity
   * is checked, the first year's fee is taken (or, by a super admin, waived), and
   * the membership year starts today.
   */
  async approve(ctx: AuthContext, id: number, body: ApproveRequest): Promise<MemberDetail> {
    const target = await this.memberFor(ctx, id);
    if (target.status !== 'pending') {
      throw AppError.conflict('not_pending', 'Only an application still waiting can be approved.');
    }
    assertMayTakePayment(ctx, body.payment);

    return this.uow.run(ctx.actor, async (tx, log) => {
      const today = todayColombo();
      const expireAt = addYears(today, 1);
      const [after] = await tx
        .update(appUser)
        .set({
          status: 'active',
          approvedAt: new Date(),
          approvedBy: ctx.user.id,
          identityCheckedBy: ctx.user.id,
          expireAt,
          rejectionReason: null,
        })
        .where(eq(appUser.id, id))
        .returning();
      await this.recordFirstPayment(tx, log, ctx, after!, body.payment, today, expireAt);
      await log({
        action: 'application.approve',
        entity: 'app_user',
        entityId: id,
        branchId: target.branchId,
        before: { status: target.status },
        after: { status: 'active', expireAt, identityChecked: true, payment: body.payment.kind },
      });
      return this.detailOf(tx, after!);
    });
  }

  async reject(ctx: AuthContext, id: number, reason: string): Promise<MemberDetail> {
    const target = await this.memberFor(ctx, id);
    if (target.status !== 'pending') {
      throw AppError.conflict('not_pending', 'Only an application still waiting can be rejected.');
    }
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [after] = await tx
        .update(appUser)
        .set({ status: 'rejected', rejectionReason: reason })
        .where(eq(appUser.id, id))
        .returning();
      await this.sessions.revokeAllForUser(tx, id);
      await log({
        action: 'application.reject',
        entity: 'app_user',
        entityId: id,
        branchId: target.branchId,
        before: { status: 'pending' },
        after: { status: 'rejected', reason },
      });
      return this.detailOf(tx, after!);
    });
  }

  /**
   * Reopens a rejected application until it is anonymised. The 90-day clock of
   * FR-AUT-20 starts again from today.
   */
  async reopen(ctx: AuthContext, id: number): Promise<MemberDetail> {
    const target = await this.memberFor(ctx, id);
    if (target.status !== 'rejected') {
      throw AppError.conflict('not_rejected', 'Only a rejected application can be reopened.');
    }
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [after] = await tx
        .update(appUser)
        .set({ status: 'pending', rejectionReason: null, appliedAt: new Date() })
        .where(eq(appUser.id, id))
        .returning();
      await log({
        action: 'application.reopen',
        entity: 'app_user',
        entityId: id,
        branchId: target.branchId,
        before: { status: 'rejected', reason: target.rejectionReason },
        after: { status: 'pending' },
      });
      return this.detailOf(tx, after!);
    });
  }

  /**
   * FR-AUT-05: a member registered at the counter goes through the same identity
   * check and first fee as an approval, and is active at once with a temporary
   * password.
   */
  async register(
    ctx: AuthContext,
    body: ParsedRegistration,
  ): Promise<{ member: MemberDetail; temporaryPassword: string }> {
    assertBranchAccess(ctx.user, body.homeBranchId);
    await this.assertBranchExists(this.db, body.homeBranchId);
    if (await findUserByPhone(this.db, body.whatsappPhone)) throw phoneInUse();
    this.assertPastDate(body.dateOfBirth);
    assertMayTakePayment(ctx, body.payment);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const member = await this.uow.run(ctx.actor, async (tx, log) => {
      const today = todayColombo();
      const expireAt = addYears(today, 1);
      const now = new Date();
      const [row] = await tx
        .insert(appUser)
        .values({
          ...personValues(body),
          whatsappPhone: body.whatsappPhone,
          userType: 'member',
          status: 'active',
          passwordHash,
          mustChangePassword: true,
          introducerConsent: true,
          appliedAt: now,
          approvedAt: now,
          approvedBy: ctx.user.id,
          identityCheckedBy: ctx.user.id,
          expireAt,
        })
        .returning();
      await this.recordFirstPayment(tx, log, ctx, row!, body.payment, today, expireAt);
      await log({
        action: 'member.register',
        entity: 'app_user',
        entityId: row!.id,
        branchId: row!.branchId,
        after: { ...loggableUser(row!), identityChecked: true, payment: body.payment.kind },
      });
      return this.detailOf(tx, row!);
    });
    return { member, temporaryPassword };
  }

  // ─── Staff: members (FR-MEM-02, FR-MEM-03, FR-MEM-09) ──────────────────────

  /** Finds members by part of the name or the phone number, within the actor's branch. */
  async search(ctx: AuthContext, query: string): Promise<MemberSummary[]> {
    const q = query.trim();
    const scope = branchScope(ctx.user);
    const phone = normalizePhone(q);
    const digits = q.replace(/\D/g, '');
    const match = q
      ? or(
          ilike(appUser.fullName, `%${escapeLike(q)}%`),
          phone ? eq(appUser.whatsappPhone, phone) : undefined,
          digits.length >= 4 ? ilike(appUser.whatsappPhone, `%${digits}%`) : undefined,
        )
      : undefined;
    const rows = await this.db
      .select({ user: appUser, staleDays: branchSetting.applicationStaleDays })
      .from(appUser)
      .innerJoin(branchSetting, eq(branchSetting.branchId, appUser.branchId))
      .where(
        and(
          eq(appUser.userType, 'member'),
          ne(appUser.status, 'anonymised'),
          scope === null ? undefined : eq(appUser.branchId, scope),
          match,
        ),
      )
      .orderBy(asc(appUser.fullName))
      .limit(50);
    const today = todayColombo();
    return rows.map((r) => toMemberSummary(r.user, today, r.staleDays));
  }

  async detail(ctx: AuthContext, id: number): Promise<MemberDetail> {
    return this.detailOf(this.db, await this.memberFor(ctx, id));
  }

  /** FR-MEM-02: the annual fee, extending the membership by one year. */
  async renew(ctx: AuthContext, id: number, body: RenewRequest): Promise<MemberDetail> {
    const target = await this.memberFor(ctx, id);
    if (target.status !== 'active' && target.status !== 'suspended') {
      throw AppError.conflict(
        'cannot_renew',
        'Only an approved member can renew; approve the application instead.',
      );
    }
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [settings] = await tx
        .select({ grace: branchSetting.renewalGraceDays })
        .from(branchSetting)
        .where(eq(branchSetting.branchId, target.branchId!));
      const today = todayColombo();
      const extendsTo = renewedExpiry(target.expireAt, today, settings?.grace ?? 90);
      const [payment] = await tx
        .insert(membershipPayment)
        .values({
          userId: id,
          kind: 'fee',
          amountCents: body.amountCents,
          paidOn: today,
          receiptNo: body.receiptNo,
          collectedBy: ctx.user.id,
          extendsTo,
        })
        .returning();
      const [after] = await tx
        .update(appUser)
        .set({ expireAt: extendsTo })
        .where(eq(appUser.id, id))
        .returning();
      await log({
        action: 'membership.renew',
        entity: 'membership_payment',
        entityId: payment!.id,
        branchId: target.branchId,
        before: { expireAt: target.expireAt },
        after: { expireAt: extendsTo, amountCents: body.amountCents, receiptNo: body.receiptNo },
      });
      return this.detailOf(tx, after!);
    });
  }

  /** FR-MEM-03: paid in the last 30 days, expiring in the next 30, already expired. */
  async overview(ctx: AuthContext): Promise<MembershipOverview> {
    const scope = branchScope(ctx.user);
    const today = todayColombo();
    const inScope = scope === null ? undefined : eq(appUser.branchId, scope);
    const base = () =>
      this.db
        .select({ user: appUser, staleDays: branchSetting.applicationStaleDays })
        .from(appUser)
        .innerJoin(branchSetting, eq(branchSetting.branchId, appUser.branchId));
    const recent = this.db
      .selectDistinct({ userId: membershipPayment.userId })
      .from(membershipPayment)
      .where(
        and(
          inArray(membershipPayment.kind, ['fee', 'first_fee', 'waiver']),
          gte(membershipPayment.paidOn, addDays(today, -30)),
        ),
      );
    const member = and(eq(appUser.userType, 'member'), eq(appUser.status, 'active'), inScope);

    const [paidRecently, expiringSoon, expired] = await Promise.all([
      base()
        .where(and(member, inArray(appUser.id, recent)))
        .orderBy(desc(appUser.expireAt))
        .limit(200),
      base()
        .where(and(member, gte(appUser.expireAt, today), lte(appUser.expireAt, addDays(today, 30))))
        .orderBy(asc(appUser.expireAt))
        .limit(200),
      base()
        .where(and(member, or(lt(appUser.expireAt, today), sql`${appUser.expireAt} IS NULL`)))
        .orderBy(desc(appUser.expireAt))
        .limit(200),
    ]);
    const view = (rows: { user: UserRow; staleDays: number }[]) =>
      rows.map((r) => toMemberSummary(r.user, today, r.staleDays));
    return {
      paidRecently: view(paidRecently),
      expiringSoon: view(expiringSoon),
      expired: view(expired),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** A member the actor may see: their own branch for an admin, any for a super admin. */
  private async memberFor(ctx: AuthContext, id: number): Promise<UserRow> {
    const target = await findUserById(this.db, id);
    if (!target || target.userType !== 'member' || target.status === 'anonymised') {
      throw AppError.notFound('member_not_found', 'No such member.');
    }
    assertBranchAccess(ctx.user, target.branchId);
    return target;
  }

  /** A member's full record; callers check who may see it (FR-REQ-03 shows it to both branches). */
  async detailOf(q: Queryable, row: UserRow): Promise<MemberDetail> {
    const [payments, settings] = await Promise.all([
      q
        .select()
        .from(membershipPayment)
        .where(eq(membershipPayment.userId, row.id))
        .orderBy(desc(membershipPayment.paidOn), desc(membershipPayment.id)),
      row.branchId === null
        ? Promise.resolve([])
        : q
            .select({ staleDays: branchSetting.applicationStaleDays })
            .from(branchSetting)
            .where(eq(branchSetting.branchId, row.branchId)),
    ]);
    return toMemberDetail(row, payments, todayColombo(), settings[0]?.staleDays ?? 30);
  }

  private async recordFirstPayment(
    tx: Tx,
    log: Log,
    ctx: AuthContext,
    member: UserRow,
    payment: FirstPayment,
    today: string,
    expireAt: string,
  ): Promise<void> {
    const values =
      payment.kind === 'first_fee'
        ? {
            kind: 'first_fee' as const,
            amountCents: payment.amountCents,
            receiptNo: payment.receiptNo,
            reason: null,
          }
        : { kind: 'waiver' as const, amountCents: 0, receiptNo: null, reason: payment.reason };
    const [row] = await tx
      .insert(membershipPayment)
      .values({
        ...values,
        userId: member.id,
        paidOn: today,
        collectedBy: ctx.user.id,
        extendsTo: expireAt,
      })
      .returning();
    await log({
      action: payment.kind === 'first_fee' ? 'membership.first_fee' : 'membership.fee_waived',
      entity: 'membership_payment',
      entityId: row!.id,
      branchId: member.branchId,
      after: { userId: member.id, ...values, extendsTo: expireAt },
    });
  }

  private async assertBranchExists(q: Queryable, branchId: number): Promise<void> {
    const [row] = await q.select({ id: branch.id }).from(branch).where(eq(branch.id, branchId));
    if (!row) throw AppError.badRequest('branch_not_found', 'No such branch.');
  }

  private assertPastDate(date: string): void {
    if (date >= todayColombo()) {
      throw AppError.badRequest('invalid_date_of_birth', 'The date of birth must be in the past.');
    }
  }
}

/** Only a super admin may approve or register with the first fee waived (FR-MEM-10). */
function assertMayTakePayment(ctx: AuthContext, payment: FirstPayment): void {
  if (payment.kind === 'waiver' && ctx.user.userType !== 'super_admin') {
    throw AppError.forbidden(
      'waiver_super_admin_only',
      'Only a super admin can waive the first fee.',
    );
  }
}

function personValues(body: {
  fullName: string;
  address: string;
  dateOfBirth: string;
  otherPhone: string | null;
  organisation: string | null;
  introducedByName: string;
  introducedByPhone: string;
  homeBranchId: number;
}) {
  return {
    fullName: body.fullName,
    address: body.address,
    dateOfBirth: body.dateOfBirth,
    otherPhone: body.otherPhone,
    organisation: body.organisation,
    introducedByName: body.introducedByName,
    introducedByPhone: body.introducedByPhone,
    branchId: body.homeBranchId,
  };
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(
    keys.filter((k) => k in obj).map((k) => [k, obj[k as keyof T]]),
  ) as Partial<T>;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
