import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  BACKDATE_MAX_DAYS,
  type CopyState,
  daysBetween,
  daysLate,
  type IssueCheck,
  isOverdue,
  type Loan,
  loanStanding,
  type LoanStanding,
  type MemberLoans,
  normalizeAccession,
  todayColombo,
} from '@pothgula/shared';
import { desc, eq, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { type Log, UnitOfWork } from '../audit/unit-of-work';
import type { UserRow } from '../auth/users';
import { AppError } from '../common/app-error';
import { isPgError, PG } from '../common/pg-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Queryable, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, borrow, branchSetting, copy, title } from '../db/schema';
import { issueRefusals, REFUSAL_MESSAGES } from './issue-rules';

type BorrowRow = typeof borrow.$inferSelect;
type CopyRow = typeof copy.$inferSelect;

interface Rules {
  loanDays: number;
  maxBooks: number;
  frequentLateCount: number;
  frequentLateMonths: number;
}

const memberNotFound = () => AppError.notFound('member_not_found', 'No such member.');
const copyNotFound = () => AppError.notFound('copy_not_found', 'No copy has that number.');
const loanNotFound = () => AppError.notFound('loan_not_found', 'No such loan.');

/**
 * Circulation (§7): issuing and taking back at the counter, corrections, voids
 * and the paper fallback. Each loan is one `borrow` row; where a copy is, how
 * late a loan is and how often a member is late are worked out from the dates
 * (R2). Every change is written with its log entry in the same transaction.
 */
@Injectable()
export class CirculationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  // ─── Issuing (FR-CIR-01, FR-CIR-02, FR-CIR-06, FR-CIR-07, FR-CIR-14) ─────────

  /** What the counter shows before confirming: the book, the due date, any refusals. Writes nothing. */
  async check(
    ctx: AuthContext,
    body: { memberId: number; accessionNo: string; borrowDate?: string },
  ): Promise<IssueCheck> {
    return this.evaluate(this.db, ctx, body, false);
  }

  async issue(
    ctx: AuthContext,
    body: { memberId: number; accessionNo: string; borrowDate?: string },
  ): Promise<Loan> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      // Locks the member and the copy, so two counters cannot both pass the checks.
      const check = await this.evaluate(tx, ctx, body, true);
      const [first] = check.refusals;
      if (first) {
        throw AppError.unprocessable(first.code, REFUSAL_MESSAGES[first.code], {
          refusals: check.refusals,
        });
      }
      let row: BorrowRow | undefined;
      try {
        [row] = await tx
          .insert(borrow)
          .values({
            copyId: check.copy.id,
            userId: check.member.id,
            branchId: check.member.branchId!,
            borrowDate: check.borrowDate,
            dueDate: check.dueDate,
            originalDueDate: check.dueDate,
            issuedBy: ctx.user.id,
            isBackdated: check.isBackdated,
          })
          .returning();
      } catch (err) {
        if (isPgError(err, PG.uniqueViolation, 'borrow_one_open_loan_per_copy')) {
          throw AppError.unprocessable('copy_on_loan', REFUSAL_MESSAGES.copy_on_loan);
        }
        throw err;
      }
      await log({
        action: check.isBackdated ? 'borrow.issue_backdated' : 'borrow.issue',
        entity: 'borrow',
        entityId: row!.id,
        branchId: row!.branchId,
        after: {
          memberId: check.member.id,
          copyId: check.copy.id,
          accessionNo: check.copy.accessionNo,
          borrowDate: row!.borrowDate,
          dueDate: row!.dueDate,
          ...(check.isBackdated ? { backdated: true } : {}),
        },
      });
      return this.loan(tx, row!.id);
    });
  }

  // ─── Taking back (FR-CIR-03, FR-CIR-04, FR-CIR-08, FR-CIR-14) ──────────────

  /** The open loan on a copy, with its days late, before the take-back is confirmed. */
  async openLoanByAccession(ctx: AuthContext, input: string): Promise<Loan> {
    const c = await this.copyByAccession(this.db, input, false);
    const [row] = await this.db
      .select({ id: borrow.id, branchId: borrow.branchId })
      .from(borrow)
      .where(
        sql`${borrow.copyId} = ${c.id} AND ${borrow.returnedOn} IS NULL AND ${borrow.voidedAt} IS NULL`,
      );
    if (!row) throw AppError.notFound('no_open_loan', 'This copy is not on loan.');
    assertBranchAccess(ctx.user, row.branchId);
    return this.loan(this.db, row.id);
  }

  async takeBack(
    ctx: AuthContext,
    id: number,
    body: { returnedOn?: string; notUseable?: boolean },
  ): Promise<Loan> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const loan = await this.lockLoan(tx, id);
      assertBranchAccess(ctx.user, loan.branchId);
      if (loan.voidedAt) throw AppError.conflict('loan_void', 'This loan has been voided.');
      if (loan.returnedOn) {
        throw AppError.conflict('already_returned', 'This book has already been taken back.');
      }
      const { date: returnedOn, backdated } = paperDate(body.returnedOn);
      if (returnedOn < loan.borrowDate) {
        throw AppError.badRequest(
          'return_before_issue',
          'A book cannot come back before it was issued.',
        );
      }
      await tx
        .update(borrow)
        .set({ returnedOn, receivedBy: ctx.user.id, returnBackdated: backdated })
        .where(eq(borrow.id, id));
      const late = daysLate({ dueDate: loan.dueDate, returnedOn }, returnedOn);
      await log({
        action: backdated ? 'borrow.return_backdated' : 'borrow.return',
        entity: 'borrow',
        entityId: id,
        branchId: loan.branchId,
        before: { returnedOn: null },
        after: {
          returnedOn,
          daysLate: late,
          ...(backdated ? { backdated: true } : {}),
          ...(body.notUseable ? { notUseable: true } : {}),
        },
      });
      if (body.notUseable) await this.setAside(tx, log, loan.copyId);
      return this.loan(tx, id);
    });
  }

  // ─── Corrections and voids (FR-CIR-05) ─────────────────────────────────────

  async correct(
    ctx: AuthContext,
    id: number,
    body: {
      accessionNo?: string;
      memberId?: number;
      borrowDate?: string;
      returnedOn?: string | null;
      reason: string;
    },
  ): Promise<Loan> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const loan = await this.lockLoan(tx, id);
      assertBranchAccess(ctx.user, loan.branchId);
      if (loan.voidedAt) throw AppError.conflict('loan_void', 'A voided loan is not corrected.');
      const today = todayColombo();
      const changes: Partial<BorrowRow> = {};

      if (body.accessionNo !== undefined) {
        const c = await this.copyByAccession(tx, body.accessionNo, true);
        if (c.id !== loan.copyId) {
          if (c.branchId !== loan.branchId) {
            throw AppError.unprocessable('copy_other_branch', REFUSAL_MESSAGES.copy_other_branch);
          }
          // An open loan moves to a copy that must itself be free to lend.
          const state = await this.copyState(tx, c.id);
          if (loan.returnedOn === null && state !== 'on_shelf') {
            const code = (
              {
                on_loan: 'copy_on_loan',
                missing: 'copy_missing',
                not_useable: 'copy_not_useable',
                withdrawn: 'copy_withdrawn',
              } as const
            )[state];
            throw AppError.unprocessable(code, REFUSAL_MESSAGES[code]);
          }
          changes.copyId = c.id;
        }
      }

      if (body.memberId !== undefined && body.memberId !== loan.userId) {
        const m = await this.memberRow(tx, body.memberId, true);
        if (m.branchId !== loan.branchId) {
          throw AppError.unprocessable(
            'member_other_branch',
            'That member belongs to another branch.',
          );
        }
        changes.userId = m.id;
      }

      if (body.borrowDate !== undefined && body.borrowDate !== loan.borrowDate) {
        if (body.borrowDate > today) {
          throw AppError.badRequest('date_in_future', 'That date has not happened yet.');
        }
        // The loan keeps its length (and any extension): the due dates move with it.
        const shift = daysBetween(loan.borrowDate, body.borrowDate);
        changes.borrowDate = body.borrowDate;
        changes.dueDate = addDays(loan.dueDate, shift);
        changes.originalDueDate = addDays(loan.originalDueDate, shift);
      }

      if (body.returnedOn !== undefined && body.returnedOn !== loan.returnedOn) {
        if (body.returnedOn === null) {
          // A take-back recorded by mistake: the loan is open again.
          changes.returnedOn = null;
          changes.receivedBy = null;
          changes.returnBackdated = false;
        } else {
          if (loan.returnedOn === null) {
            throw AppError.conflict(
              'loan_open',
              'This book is still out; take it back at the counter instead.',
            );
          }
          if (body.returnedOn > today) {
            throw AppError.badRequest('date_in_future', 'That date has not happened yet.');
          }
          changes.returnedOn = body.returnedOn;
        }
      }

      const fields = Object.keys(changes) as (keyof BorrowRow)[];
      if (fields.length === 0) {
        throw AppError.badRequest('nothing_to_change', 'The loan already says that.');
      }
      try {
        await tx.update(borrow).set(changes).where(eq(borrow.id, id));
      } catch (err) {
        if (isPgError(err, PG.uniqueViolation, 'borrow_one_open_loan_per_copy')) {
          throw AppError.unprocessable('copy_on_loan', REFUSAL_MESSAGES.copy_on_loan);
        }
        if (isPgError(err, PG.checkViolation, 'borrow_dates')) {
          throw AppError.badRequest(
            'invalid_loan_dates',
            'A book cannot come back before it was issued.',
          );
        }
        throw err;
      }
      await log({
        action: 'borrow.correct',
        entity: 'borrow',
        entityId: id,
        branchId: loan.branchId,
        before: { ...pick(loan, fields) },
        after: { ...pick(changes, fields), reason: body.reason },
      });
      return this.loan(tx, id);
    });
  }

  /** A loan entered entirely by mistake: kept, marked void, and counted nowhere (super admin). */
  async void(ctx: AuthContext, id: number, reason: string): Promise<Loan> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const loan = await this.lockLoan(tx, id);
      if (loan.voidedAt) throw AppError.conflict('loan_void', 'This loan is already void.');
      const voidedAt = new Date();
      await tx
        .update(borrow)
        .set({ voidedAt, voidedBy: ctx.user.id, voidReason: reason })
        .where(eq(borrow.id, id));
      await log({
        action: 'borrow.void',
        entity: 'borrow',
        entityId: id,
        branchId: loan.branchId,
        before: { voidedAt: null },
        after: { voidedAt: voidedAt.toISOString(), reason },
      });
      return this.loan(tx, id);
    });
  }

  // ─── Reading ───────────────────────────────────────────────────────────────

  async detail(ctx: AuthContext, id: number): Promise<Loan> {
    const loan = await this.loan(this.db, id);
    assertBranchAccess(ctx.user, loan.branchId);
    return loan;
  }

  /** FR-CIR-04, FR-CIR-09, FR-CIR-15: a member's history and standing, for staff. */
  async memberLoans(ctx: AuthContext, memberId: number): Promise<MemberLoans> {
    const member = await this.memberRow(this.db, memberId, false);
    assertBranchAccess(ctx.user, member.branchId);
    return this.historyOf(this.db, member, true);
  }

  /** FR-CIR-04: a member's own books and late returns. Voided mistakes are not shown. */
  async ownLoans(ctx: AuthContext): Promise<MemberLoans> {
    if (ctx.user.userType !== 'member') {
      throw AppError.forbidden('members_only', 'Only members borrow books.');
    }
    return this.historyOf(this.db, ctx.user, false);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async evaluate(
    q: Queryable,
    ctx: AuthContext,
    body: { memberId: number; accessionNo: string; borrowDate?: string },
    lock: boolean,
  ): Promise<IssueCheck> {
    const member = await this.memberRow(q, body.memberId, lock);
    assertBranchAccess(ctx.user, member.branchId);
    const c = await this.copyByAccession(q, body.accessionNo, lock);
    const { date: borrowDate, backdated } = paperDate(body.borrowDate);
    // One after another: inside a transaction they share a single connection.
    const state = await this.copyState(q, c.id);
    const rules = await this.rulesFor(q, member.branchId!);
    const loans = await this.loanRows(q, eq(borrow.userId, member.id));
    const t = await q.select().from(title).where(eq(title.id, c.titleId));
    const today = todayColombo();
    const standing = standingOf(loans, today, rules);
    return {
      member: { id: member.id, fullName: member.fullName, branchId: member.branchId },
      copy: {
        id: c.id,
        accessionNo: c.accessionNo,
        titleId: c.titleId,
        title: t[0]!.title,
        writer: t[0]!.writer,
        branchId: c.branchId,
        state,
      },
      borrowDate,
      dueDate: addDays(borrowDate, rules.loanDays),
      isBackdated: backdated,
      standing,
      refusals: issueRefusals({
        copy: { state, branchId: c.branchId },
        member,
        borrowDate,
        standing,
      }),
    };
  }

  private async historyOf(q: Queryable, member: UserRow, withVoid: boolean): Promise<MemberLoans> {
    const [rules, rows] = await Promise.all([
      this.rulesFor(q, member.branchId!),
      this.loanRows(q, eq(borrow.userId, member.id)),
    ]);
    const today = todayColombo();
    return {
      standing: standingOf(rows, today, rules),
      loans: rows.filter((r) => withVoid || !r.borrow.voidedAt).map((r) => toLoan(r, today)),
    };
  }

  /** A member account (never staff, never anonymised), optionally locked for the transaction. */
  private async memberRow(q: Queryable, id: number, lock: boolean): Promise<UserRow> {
    const query = q.select().from(appUser).where(eq(appUser.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row || row.userType !== 'member' || row.status === 'anonymised' || row.branchId === null) {
      throw memberNotFound();
    }
    return row;
  }

  private async copyByAccession(q: Queryable, input: string, lock: boolean): Promise<CopyRow> {
    const accessionNo = normalizeAccession(input);
    if (!accessionNo) throw copyNotFound();
    const query = q.select().from(copy).where(eq(copy.accessionNo, accessionNo));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw copyNotFound();
    return row;
  }

  private async copyState(q: Queryable, copyId: number): Promise<CopyState> {
    const result = await q.execute<{ state: CopyState }>(
      sql`SELECT state FROM copy_availability WHERE copy_id = ${copyId}`,
    );
    return result.rows[0]!.state;
  }

  private async rulesFor(q: Queryable, branchId: number): Promise<Rules> {
    const [row] = await q
      .select({
        loanDays: branchSetting.loanDays,
        maxBooks: branchSetting.maxBooks,
        frequentLateCount: branchSetting.frequentLateCount,
        frequentLateMonths: branchSetting.frequentLateMonths,
      })
      .from(branchSetting)
      .where(eq(branchSetting.branchId, branchId));
    // Every branch is created with its settings row; these are the v3.1 defaults.
    return row ?? { loanDays: 14, maxBooks: 2, frequentLateCount: 3, frequentLateMonths: 12 };
  }

  private async lockLoan(tx: Tx, id: number): Promise<BorrowRow> {
    const [row] = await tx.select().from(borrow).where(eq(borrow.id, id)).for('update');
    if (!row) throw loanNotFound();
    return row;
  }

  /** FR-CIR-08: a book that came back damaged is set aside as not useable. */
  private async setAside(tx: Tx, log: Log, copyId: number): Promise<void> {
    const [before] = await tx.select().from(copy).where(eq(copy.id, copyId)).for('update');
    if (before!.condition === 'not_useable') return;
    await tx.update(copy).set({ condition: 'not_useable' }).where(eq(copy.id, copyId));
    await log({
      action: 'copy.update',
      entity: 'copy',
      entityId: copyId,
      branchId: before!.branchId,
      before: { condition: before!.condition },
      after: { condition: 'not_useable', accessionNo: before!.accessionNo },
    });
  }

  private loanRows(q: Queryable, where: SQL) {
    return q
      .select({
        borrow,
        accessionNo: copy.accessionNo,
        titleId: copy.titleId,
        title: title.title,
        writer: title.writer,
        memberName: appUser.fullName,
        memberPhone: appUser.whatsappPhone,
      })
      .from(borrow)
      .innerJoin(copy, eq(copy.id, borrow.copyId))
      .innerJoin(title, eq(title.id, copy.titleId))
      .innerJoin(appUser, eq(appUser.id, borrow.userId))
      .where(where)
      .orderBy(desc(borrow.borrowDate), desc(borrow.id));
  }

  private async loan(q: Queryable, id: number): Promise<Loan> {
    const [row] = await this.loanRows(q, eq(borrow.id, id));
    if (!row) throw loanNotFound();
    return toLoan(row, todayColombo());
  }
}

type LoanRow = Awaited<ReturnType<CirculationService['loanRows']>>[number];

function toLoan(r: LoanRow, today: string): Loan {
  const b = r.borrow;
  const voided = b.voidedAt !== null;
  const dates = { dueDate: b.dueDate, returnedOn: b.returnedOn, voided };
  return {
    id: b.id,
    copyId: b.copyId,
    accessionNo: r.accessionNo,
    titleId: r.titleId,
    title: r.title,
    writer: r.writer,
    memberId: b.userId,
    memberName: r.memberName,
    memberPhone: r.memberPhone,
    branchId: b.branchId,
    borrowDate: b.borrowDate,
    dueDate: b.dueDate,
    originalDueDate: b.originalDueDate,
    returnedOn: b.returnedOn,
    status: voided ? 'void' : b.returnedOn ? 'returned' : 'open',
    overdue: isOverdue(dates, today),
    daysLate: daysLate(dates, today),
    isBackdated: b.isBackdated,
    returnBackdated: b.returnBackdated,
    voidedAt: b.voidedAt?.toISOString() ?? null,
    voidReason: b.voidReason,
  };
}

function standingOf(rows: LoanRow[], today: string, rules: Rules): LoanStanding {
  return loanStanding(
    rows.map((r) => ({
      dueDate: r.borrow.dueDate,
      returnedOn: r.borrow.returnedOn,
      voided: r.borrow.voidedAt !== null,
    })),
    today,
    rules,
  );
}

/**
 * FR-CIR-14: the date of a counter transaction — today, or the real date of
 * one written on paper during an outage, up to seven days back.
 */
function paperDate(input: string | undefined): { date: string; backdated: boolean } {
  const today = todayColombo();
  if (input === undefined || input === today) return { date: today, backdated: false };
  if (input > today) throw AppError.badRequest('date_in_future', 'That date has not happened yet.');
  if (input < addDays(today, -BACKDATE_MAX_DAYS)) {
    throw AppError.badRequest(
      'backdate_too_old',
      `Paper transactions can be entered up to ${BACKDATE_MAX_DAYS} days back.`,
    );
  }
  return { date: input, backdated: true };
}

function pick<T extends object>(obj: T, keys: (keyof T | string)[]): Partial<T> {
  return Object.fromEntries(
    keys.filter((k) => k in obj).map((k) => [k, obj[k as keyof T]]),
  ) as Partial<T>;
}
