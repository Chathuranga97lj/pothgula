import { Inject, Injectable } from '@nestjs/common';
import { addDays, isOverdue, type Loan, todayColombo } from '@pothgula/shared';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { assertBranchAccess, branchScope } from '../common/scope';
import type { Db, Queryable, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, borrow, branchSetting } from '../db/schema';
import { type ExtensionAction, EXTENSION_MESSAGES, extensionRefusals } from './extension-rules';
import { loanQuery, toLoan } from './loan-view';

type BorrowRow = typeof borrow.$inferSelect;

const loanNotFound = () => AppError.notFound('loan_not_found', 'No such loan.');

/**
 * FR-CIR-10 to FR-CIR-13: one extension per loan. A member asks from their
 * dashboard and may withdraw the request; staff of the loan's branch (or a super
 * admin) approve or decline it, or grant one directly at the counter. Approval
 * moves the due date one loan period on from the original due date. A request
 * waiting protects the loan from being overdue; a decline after the due date
 * gives the member the branch's grace days from the decision.
 */
@Injectable()
export class ExtensionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  /** FR-CIR-10: the member asks, from their dashboard. */
  request(ctx: AuthContext, id: number): Promise<Loan> {
    return this.change(ctx, id, 'request', async (tx, loan) => {
      const requestedAt = new Date();
      await tx
        .update(borrow)
        .set({ extensionStatus: 'requested', extensionRequestedAt: requestedAt })
        .where(eq(borrow.id, id));
      return {
        action: 'borrow.extension_request',
        before: { extensionStatus: loan.extensionStatus },
        after: { extensionStatus: 'requested', dueDate: loan.dueDate },
      };
    });
  }

  /** The member withdraws a request staff have not decided. */
  cancel(ctx: AuthContext, id: number): Promise<Loan> {
    return this.change(ctx, id, 'cancel', async (tx) => {
      await tx
        .update(borrow)
        .set({ extensionStatus: 'none', extensionRequestedAt: null })
        .where(eq(borrow.id, id));
      return {
        action: 'borrow.extension_cancel',
        before: { extensionStatus: 'requested' },
        after: { extensionStatus: 'none' },
      };
    });
  }

  /** FR-CIR-11: staff grant it directly, when the member asks in person or by telephone. */
  grant(ctx: AuthContext, id: number): Promise<Loan> {
    return this.change(ctx, id, 'grant', async (tx, loan) => {
      const dueDate = await this.extendedDue(tx, loan);
      await tx
        .update(borrow)
        .set({
          extensionStatus: 'approved',
          extensionDecidedAt: new Date(),
          extensionDecidedBy: ctx.user.id,
          extensionReason: null,
          dueDate,
        })
        .where(eq(borrow.id, id));
      return {
        action: 'borrow.extension_grant',
        before: { extensionStatus: loan.extensionStatus, dueDate: loan.dueDate },
        after: { extensionStatus: 'approved', dueDate, source: 'staff' },
      };
    });
  }

  /** FR-CIR-10: staff approve a member's request; the due date moves on from the original. */
  approve(ctx: AuthContext, id: number): Promise<Loan> {
    return this.change(ctx, id, 'approve', async (tx, loan) => {
      const dueDate = await this.extendedDue(tx, loan);
      await tx
        .update(borrow)
        .set({
          extensionStatus: 'approved',
          extensionDecidedAt: new Date(),
          extensionDecidedBy: ctx.user.id,
          dueDate,
        })
        .where(eq(borrow.id, id));
      return {
        action: 'borrow.extension_approve',
        before: { extensionStatus: 'requested', dueDate: loan.dueDate },
        after: { extensionStatus: 'approved', dueDate, source: 'request' },
      };
    });
  }

  /**
   * FR-CIR-10, FR-CIR-13: staff decline, with a reason the member sees. Declined
   * after the due date has passed, the member has the branch's grace days from
   * today to bring the book back before it counts as late.
   */
  decline(ctx: AuthContext, id: number, reason: string): Promise<Loan> {
    return this.change(ctx, id, 'decline', async (tx, loan, today) => {
      const { declineGraceDays } = await this.rules(tx, loan.branchId);
      const graceUntil = addDays(today, declineGraceDays);
      const dueDate = today > loan.dueDate && graceUntil > loan.dueDate ? graceUntil : loan.dueDate;
      await tx
        .update(borrow)
        .set({
          extensionStatus: 'declined',
          extensionDecidedAt: new Date(),
          extensionDecidedBy: ctx.user.id,
          extensionReason: reason,
          dueDate,
        })
        .where(eq(borrow.id, id));
      return {
        action: 'borrow.extension_decline',
        before: { extensionStatus: 'requested', dueDate: loan.dueDate },
        after: {
          extensionStatus: 'declined',
          reason,
          ...(dueDate !== loan.dueDate ? { dueDate, graceDays: declineGraceDays } : {}),
        },
      };
    });
  }

  /** FR-CIR-12: requests waiting for a decision, the soonest due first. */
  async waiting(ctx: AuthContext, branchId: number | null): Promise<Loan[]> {
    if (branchId !== null) assertBranchAccess(ctx.user, branchId);
    const scope = branchId ?? branchScope(ctx.user);
    const today = todayColombo();
    const rows = await loanQuery(this.db)
      .where(
        and(
          eq(borrow.extensionStatus, 'requested'),
          isNull(borrow.returnedOn),
          isNull(borrow.voidedAt),
          scope === null ? undefined : eq(borrow.branchId, scope),
        ),
      )
      .orderBy(asc(borrow.dueDate), asc(borrow.extensionRequestedAt));
    return rows.map((r) => toLoan(r, today));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Locks the loan and its member, checks who may act and every rule, makes the
   * change and logs it in the same transaction, and answers the loan as it now is.
   */
  private change(
    ctx: AuthContext,
    id: number,
    action: ExtensionAction,
    apply: (
      tx: Tx,
      loan: BorrowRow,
      today: string,
    ) => Promise<{ action: string; before: object; after: object }>,
  ): Promise<Loan> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [loan] = await tx.select().from(borrow).where(eq(borrow.id, id)).for('update');
      if (!loan) throw loanNotFound();
      const byMember = action === 'request' || action === 'cancel';
      if (byMember) {
        // A member sees only their own loans; another's is not theirs to know about.
        if (ctx.user.userType !== 'member' || loan.userId !== ctx.user.id) throw loanNotFound();
      } else {
        assertBranchAccess(ctx.user, loan.branchId);
      }

      const [member] = await tx
        .select({ status: appUser.status })
        .from(appUser)
        .where(eq(appUser.id, loan.userId))
        .for('update');
      const today = todayColombo();
      const refusals = extensionRefusals({
        action,
        loan: {
          returnedOn: loan.returnedOn,
          voided: loan.voidedAt !== null,
          dueDate: loan.dueDate,
          extensionStatus: loan.extensionStatus,
        },
        memberStatus: member!.status,
        otherOverdue: await this.otherOverdue(tx, loan, today),
        today,
      });
      if (refusals.length > 0) {
        throw AppError.unprocessable(refusals[0]!, EXTENSION_MESSAGES[refusals[0]!], {
          refusals: refusals.map((code) => ({ code })),
        });
      }

      const entry = await apply(tx, loan, today);
      await log({ ...entry, entity: 'borrow', entityId: id, branchId: loan.branchId });
      const [row] = await loanQuery(tx).where(eq(borrow.id, id));
      return toLoan(row!, today);
    });
  }

  private async otherOverdue(q: Queryable, loan: BorrowRow, today: string): Promise<number> {
    const others = await q
      .select()
      .from(borrow)
      .where(
        and(
          eq(borrow.userId, loan.userId),
          ne(borrow.id, loan.id),
          isNull(borrow.returnedOn),
          isNull(borrow.voidedAt),
        ),
      );
    return others.filter((b) =>
      isOverdue(
        { dueDate: b.dueDate, returnedOn: b.returnedOn, extensionStatus: b.extensionStatus },
        today,
      ),
    ).length;
  }

  /**
   * FR-CIR-07, FR-CIR-10: one loan period on from the original due date, whatever
   * day it is decided — never earlier than the due date already set.
   */
  private async extendedDue(q: Queryable, loan: BorrowRow): Promise<string> {
    const { loanDays } = await this.rules(q, loan.branchId);
    const extended = addDays(loan.originalDueDate, loanDays);
    return extended > loan.dueDate ? extended : loan.dueDate;
  }

  private async rules(q: Queryable, branchId: number) {
    const [row] = await q
      .select({
        loanDays: branchSetting.loanDays,
        declineGraceDays: branchSetting.declineGraceDays,
      })
      .from(branchSetting)
      .where(eq(branchSetting.branchId, branchId));
    return row ?? { loanDays: 14, declineGraceDays: 3 };
  }
}
