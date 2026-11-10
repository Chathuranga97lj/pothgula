import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  EXTENSION_URGENT_DAYS,
  HOLD_LAPSING_DAYS,
  type BranchDue,
  type BranchRef,
  callList,
  type DueLists,
  type DueLoan,
  endOfMonth,
  type MemberDashboard,
  type StaffCounts,
  SETTLEMENT_CLOSING_DAYS,
  type StaffDashboard,
  staffPanel,
  todayColombo,
} from '@pothgula/shared';
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthContext } from '../auth/auth-context';
import {
  loanColumns,
  loanQuery,
  notLost,
  notProtectedByRequest,
  toLoan,
} from '../circulation/loan-view';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, bookSettlement, borrow, branch, branchSetting, copy, title } from '../db/schema';
import { RequestsService } from '../requests/requests.service';
import { SettlementsService } from '../settlements/settlements.service';
import { memberPanel } from './member-panel';

const memberBranch = alias(branch, 'member_branch');
const copyBranch = alias(branch, 'copy_branch');

type BranchWithSettings = BranchRef & { warningDays: number };

const countWhere = (cond: SQL | undefined) =>
  sql<number>`count(*) filter (where ${cond})`.mapWith(Number);

/**
 * §13: today's work for staff, a member's own panel, and the lists behind them.
 * Everything is worked out from live data on each request (FR-NOT-10); nothing
 * here writes, and none of it is logged (FR-LOG-12: ordinary reads).
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly requests: RequestsService,
    private readonly settlements: SettlementsService,
  ) {}

  // ─── Staff (FR-NOT-03, FR-NOT-07, FR-NOT-09) ───────────────────────────────

  async staff(ctx: AuthContext): Promise<StaffDashboard> {
    const today = todayColombo();
    const monthEnd = endOfMonth(today);
    const branches = await this.branchesFor(ctx);
    const ids = branches.map((b) => b.branchId);
    if (ids.length === 0) return { today, monthEnd, branches: [] };

    const open = isNull(borrow.returnedOn);
    const overdue = and(open, sql`${borrow.dueDate} < ${today}`, notProtectedByRequest);
    const waiting = and(open, eq(borrow.extensionStatus, 'requested'));
    const loans = await this.db
      .select({
        branchId: borrow.branchId,
        overdue: countWhere(overdue),
        overdueMembers:
          sql<number>`count(distinct ${borrow.userId}) filter (where ${overdue})`.mapWith(Number),
        dueToday: countWhere(and(open, eq(borrow.dueDate, today))),
        dueSoon: countWhere(
          and(
            open,
            sql`${borrow.dueDate} >= ${today}`,
            sql`${borrow.dueDate} <= ${today}::date + ${branchSetting.staffDueWarningDays}`,
          ),
        ),
        returnedLateToday: countWhere(
          and(
            eq(borrow.returnedOn, today),
            sql`${borrow.returnedOn} > ${borrow.dueDate}`,
            notProtectedByRequest,
            notLost,
          ),
        ),
        extensionsWaiting: countWhere(waiting),
        extensionsUrgent: countWhere(
          and(waiting, sql`${borrow.dueDate} <= ${addDays(today, EXTENSION_URGENT_DAYS)}`),
        ),
      })
      .from(borrow)
      .innerJoin(branchSetting, eq(branchSetting.branchId, borrow.branchId))
      .where(
        and(
          inArray(borrow.branchId, ids),
          isNull(borrow.voidedAt),
          or(open, eq(borrow.returnedOn, today)),
        ),
      )
      .groupBy(borrow.branchId);

    const people = await this.db
      .select({
        branchId: appUser.branchId,
        pending: countWhere(eq(appUser.status, 'pending')),
        suspended: countWhere(eq(appUser.status, 'suspended')),
        expiring: countWhere(
          and(
            eq(appUser.status, 'active'),
            sql`${appUser.expireAt} >= ${today}`,
            sql`${appUser.expireAt} <= ${monthEnd}`,
          ),
        ),
      })
      .from(appUser)
      .where(and(eq(appUser.userType, 'member'), inArray(appUser.branchId, ids)))
      .groupBy(appUser.branchId);

    // FR-LST-10, FR-LST-14: unsettled lost books at the member's branch.
    const owed = await this.db
      .select({
        branchId: bookSettlement.branchId,
        open: sql<number>`count(*)`.mapWith(Number),
        passed: countWhere(sql`${bookSettlement.windowEnds} < ${today}`),
        closing: countWhere(
          and(
            sql`${bookSettlement.windowEnds} >= ${today}`,
            sql`${bookSettlement.windowEnds} <= ${addDays(today, SETTLEMENT_CLOSING_DAYS)}`,
          ),
        ),
      })
      .from(bookSettlement)
      .where(and(eq(bookSettlement.status, 'open'), inArray(bookSettlement.branchId, ids)))
      .groupBy(bookSettlement.branchId);

    // FR-REQ-09: the same lists the requests page shows, counted.
    const board = await this.requests.board(ctx, null);
    const lapsingBy = addDays(today, HOLD_LAPSING_DAYS);

    return {
      today,
      monthEnd,
      branches: branches.map((b) => {
        const l = loans.find((r) => r.branchId === b.branchId);
        const r = board.branches.find((x) => x.branchId === b.branchId);
        const p = people.find((r) => r.branchId === b.branchId);
        const o = owed.find((r) => r.branchId === b.branchId);
        const counts: StaffCounts = {
          suspended: p?.suspended ?? 0,
          settlements_passed: o?.passed ?? 0,
          settlements_closing: o?.closing ?? 0,
          settlements_open: o?.open ?? 0,
          overdue: l?.overdue ?? 0,
          overdueMembers: l?.overdueMembers ?? 0,
          transit_overdue: r?.transitOverdue.length ?? 0,
          extensions_urgent: l?.extensionsUrgent ?? 0,
          due_today: l?.dueToday ?? 0,
          applications_waiting: p?.pending ?? 0,
          extensions_waiting: l?.extensionsWaiting ?? 0,
          requests_to_decide: r?.toDecide.length ?? 0,
          requests_to_send: r?.toSend.length ?? 0,
          holds_lapsing: r?.held.filter((h) => (h.holdUntil ?? today) <= lapsingBy).length ?? 0,
          requests_arriving: r?.arriving.length ?? 0,
          copies_elsewhere: r?.outElsewhere.length ?? 0,
          due_soon: l?.dueSoon ?? 0,
          returned_late_today: l?.returnedLateToday ?? 0,
          expiring_this_month: p?.expiring ?? 0,
        };
        return { ...b, counts, items: staffPanel(counts) };
      }),
    };
  }

  /** FR-NOT-04, FR-NOT-12: overdue loans above the five-day list, and today's late returns. */
  async due(ctx: AuthContext, branchId: number | null): Promise<DueLists> {
    const today = todayColombo();
    const branches = await this.branchesFor(ctx, branchId);
    const ids = branches.map((b) => b.branchId);
    if (ids.length === 0) return { today, branches: [] };

    const rows = await this.dueRows(
      and(
        inArray(borrow.branchId, ids),
        or(
          and(
            isNull(borrow.returnedOn),
            sql`${borrow.dueDate} <= ${today}::date + ${branchSetting.staffDueWarningDays}`,
          ),
          and(
            eq(borrow.returnedOn, today),
            sql`${borrow.returnedOn} > ${borrow.dueDate}`,
            notProtectedByRequest,
            notLost,
          ),
        ),
      )!,
      today,
    );
    return {
      today,
      branches: branches.map((b): BranchDue => {
        const mine = rows.filter((r) => r.branchId === b.branchId);
        return {
          ...b,
          overdue: mine.filter((r) => r.status === 'open' && r.overdue),
          dueSoon: mine.filter((r) => r.status === 'open' && !r.overdue),
          returnedLateToday: mine.filter((r) => r.status === 'returned'),
        };
      }),
    };
  }

  // ─── Sheets to print (FR-RPT-16, FR-NOT-04) ────────────────────────────────

  /** Every open loan at one branch, by book number: the counter's paper fallback. */
  async dailySheet(ctx: AuthContext, branchId: number | null) {
    const b = await this.oneBranch(ctx, branchId);
    const today = todayColombo();
    const loans = await this.dueRows(
      and(eq(borrow.branchId, b.branchId), isNull(borrow.returnedOn))!,
      today,
      asc(copy.accessionNo),
    );
    return { branch: b, today, loans };
  }

  /** The members to telephone about overdue books at one branch. */
  async callSheet(ctx: AuthContext, branchId: number | null) {
    const b = await this.oneBranch(ctx, branchId);
    const today = todayColombo();
    const overdue = await this.dueRows(
      and(
        eq(borrow.branchId, b.branchId),
        isNull(borrow.returnedOn),
        sql`${borrow.dueDate} < ${today}`,
        notProtectedByRequest,
      )!,
      today,
    );
    return { branch: b, today, entries: callList(overdue) };
  }

  // ─── Members (FR-NOT-01, FR-NOT-02, FR-NOT-08) ─────────────────────────────

  async member(ctx: AuthContext): Promise<MemberDashboard> {
    const user = ctx.user;
    if (user.userType !== 'member') {
      throw AppError.forbidden('members_only', 'This panel is for members.');
    }
    const today = todayColombo();
    const [home] = await this.db
      .select({
        branchName: branch.branchName,
        memberDueWarningDays: branchSetting.memberDueWarningDays,
        frequentLateCount: branchSetting.frequentLateCount,
        frequentLateMonths: branchSetting.frequentLateMonths,
        feeCents: branchSetting.annualFeeCents,
      })
      .from(branch)
      .innerJoin(branchSetting, eq(branchSetting.branchId, branch.id))
      .where(eq(branch.id, user.branchId!));
    const rows = await loanQuery(this.db).where(
      and(eq(borrow.userId, user.id), isNull(borrow.voidedAt)),
    );
    const items = memberPanel(
      {
        status: user.status,
        expireAt: user.expireAt,
        loans: rows.map((r) => toLoan(r, today)),
        requests: await this.requests.mine(ctx),
        settlements: await this.settlements.openFor(this.db, user.id, today),
        rules: {
          memberDueWarningDays: home?.memberDueWarningDays ?? 5,
          frequentLateCount: home?.frequentLateCount ?? 3,
          frequentLateMonths: home?.frequentLateMonths ?? 12,
        },
        branchName: home?.branchName ?? '',
        feeCents: home?.feeCents ?? 0,
      },
      today,
    );
    return { today, items };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Loans with the member's phones and both branch codes; voided loans never appear. */
  private async dueRows(where: SQL, today: string, order: SQL = asc(borrow.dueDate)) {
    const rows = await this.db
      .select({
        ...loanColumns,
        memberOtherPhone: appUser.otherPhone,
        memberBranchCode: memberBranch.branchCode,
        copyBranchCode: copyBranch.branchCode,
      })
      .from(borrow)
      .innerJoin(copy, eq(copy.id, borrow.copyId))
      .innerJoin(title, eq(title.id, copy.titleId))
      .innerJoin(appUser, eq(appUser.id, borrow.userId))
      .innerJoin(memberBranch, eq(memberBranch.id, appUser.branchId))
      .innerJoin(copyBranch, eq(copyBranch.id, copy.branchId))
      .innerJoin(branchSetting, eq(branchSetting.branchId, borrow.branchId))
      .where(and(isNull(borrow.voidedAt), where))
      .orderBy(order, asc(appUser.fullName), asc(borrow.id));
    return rows.map((r): DueLoan => ({
      ...toLoan(r, today),
      memberOtherPhone: r.memberOtherPhone,
      memberBranchCode: r.memberBranchCode,
      copyBranchCode: r.copyBranchCode,
    }));
  }

  /** An admin's own branch; a super admin's every branch, or the one asked for. */
  private async branchesFor(
    ctx: AuthContext,
    only: number | null = null,
  ): Promise<BranchWithSettings[]> {
    const user = ctx.user;
    if (only !== null) assertBranchAccess(user, only);
    const scope = only ?? (user.userType === 'super_admin' ? null : user.branchId);
    if (user.userType !== 'super_admin' && scope === null) return [];
    const rows = await this.db
      .select({
        branchId: branch.id,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        warningDays: branchSetting.staffDueWarningDays,
      })
      .from(branch)
      .innerJoin(branchSetting, eq(branchSetting.branchId, branch.id))
      .where(scope === null ? undefined : eq(branch.id, scope))
      .orderBy(asc(branch.branchCode));
    if (only !== null && rows.length === 0) {
      throw AppError.notFound('branch_not_found', 'No such branch.');
    }
    return rows;
  }

  /** A sheet is for one branch: the admin's own, or the one a super admin chose. */
  private async oneBranch(ctx: AuthContext, branchId: number | null) {
    const chosen = branchId ?? (ctx.user.userType === 'super_admin' ? null : ctx.user.branchId);
    if (chosen === null) {
      throw AppError.badRequest('branch_required', 'Choose the branch the sheet is for.');
    }
    const [b] = await this.branchesFor(ctx, chosen);
    return b!;
  }
}

/** For the controllers: `?branchId=` is optional. */
export function optionalBranchId(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw AppError.badRequest('invalid_id', `Not a valid branch id: ${value}`);
  }
  return id;
}
