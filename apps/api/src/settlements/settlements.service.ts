import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  BACKDATE_MAX_DAYS,
  type DeclareLost,
  type LostQuote,
  type Settlement,
  type SettlementBoard,
  type SettlementRefusalCode,
  todayColombo,
} from '@pothgula/shared';
import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import type { UserRow } from '../auth/users';
import { UnitOfWork } from '../audit/unit-of-work';
import { allocateAccessionNumbers } from '../catalogue/accession';
import { AppError } from '../common/app-error';
import { isPgError, PG } from '../common/pg-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Queryable, Tx } from '../db/client';
import { DB } from '../db/db.module';
import {
  appUser,
  bookRequest,
  bookSettlement,
  borrow,
  branch,
  branchSetting,
  copy,
  lostTariff,
  settlementPayment,
  title,
} from '../db/schema';
import { settlementsWhere } from './settlement-view';
import { liftIfClear } from './suspension';

type SettlementRow = typeof bookSettlement.$inferSelect;

/** Plain English fallbacks; the web app shows its own translations of the codes. */
const MESSAGES: Record<SettlementRefusalCode, string> = {
  loan_not_open: 'This book is not out on loan.',
  settlement_not_found: 'No such settlement.',
  settlement_closed: 'This settlement is already closed.',
  settlement_not_paid: 'This settlement has no payment to reverse.',
  amount_required: 'There is no tariff amount for this category; enter the amount.',
  amount_reason_required: 'The amount differs from the tariff; give the reason.',
  amount_not_lower: 'The new amount must be lower than the amount due, and more than nothing.',
  amount_mismatch: 'The payment must be the amount due.',
  window_extended: 'The window has already been extended once.',
  payment_reversed: 'That payment has already been reversed.',
  copy_not_lost: 'This copy is not recorded as missing.',
  copy_lost_use_found: 'This copy was declared lost; a super admin returns it with “Found”.',
};

const refuse = (code: SettlementRefusalCode, status: 'conflict' | 'unprocessable' = 'conflict') =>
  status === 'conflict'
    ? AppError.conflict(code, MESSAGES[code])
    : AppError.unprocessable(code, MESSAGES[code]);

const superOnly = (ctx: AuthContext) => {
  if (ctx.user.userType !== 'super_admin') {
    throw AppError.forbidden('super_admin_only', 'Only a super admin can do this.');
  }
};

/** Settlements cleared this many days ago still show on the board. */
const RECENT_DAYS = 30;

/**
 * §9: lost and damaged books — declaring, the settlement and how it is cleared,
 * and the super admin's decisions (FR-LST-01 to FR-LST-15). Each step is one
 * unit of work with its log entries; a suspension lifts in the same transaction
 * as the step that clears it.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  // ─── Declaring (FR-LST-01, FR-LST-02, FR-LST-11, FR-LST-14) ────────────────

  /** What declaring this loan's copy lost would set: the tariff and the window. Writes nothing. */
  async quote(ctx: AuthContext, loanId: number): Promise<LostQuote> {
    const facts = await this.lossFacts(this.db, ctx, loanId, false);
    return {
      loanId,
      copyBranch: facts.copyBranch,
      categoryCode: facts.categoryCode,
      tariffCents: facts.tariffCents,
      windowDays: facts.windowDays,
      windowEnds: addDays(todayColombo(), facts.windowDays),
    };
  }

  async declare(ctx: AuthContext, loanId: number, body: DeclareLost): Promise<Settlement> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const f = await this.lossFacts(tx, ctx, loanId, true);
      const amount = body.amountCents ?? f.tariffCents;
      if (amount === null || amount === 0) throw refuse('amount_required', 'unprocessable');
      const differs = f.tariffCents !== null && amount !== f.tariffCents;
      if (differs && !body.amountReason) throw refuse('amount_reason_required', 'unprocessable');
      const today = todayColombo();
      const now = new Date();

      await tx
        .update(borrow)
        .set({ returnedOn: today, lostDeclaredAt: now, lostDeclaredBy: ctx.user.id })
        .where(eq(borrow.id, loanId));
      await log({
        action: 'borrow.lost',
        entity: 'borrow',
        entityId: loanId,
        branchId: f.loan.branchId,
        before: { returnedOn: null },
        after: { returnedOn: today, kind: body.kind, reason: body.reason },
      });

      // FR-LST-01, FR-LST-11: it leaves circulation at once.
      const condition = body.kind === 'lost' ? 'missing' : 'not_useable';
      await tx.update(copy).set({ condition }).where(eq(copy.id, f.copy.id));
      await log({
        action: 'copy.update',
        entity: 'copy',
        entityId: f.copy.id,
        branchId: f.copy.branchId,
        before: { condition: f.copy.condition },
        after: { condition, accessionNo: f.copy.accessionNo },
      });

      const [s] = await tx
        .insert(bookSettlement)
        .values({
          borrowId: loanId,
          copyId: f.copy.id,
          userId: f.loan.userId,
          branchId: f.loan.branchId,
          copyBranchId: f.copy.branchId,
          kind: body.kind,
          reason: body.reason,
          declaredOn: today,
          declaredBy: ctx.user.id,
          tariffCents: f.tariffCents,
          setAmountCents: amount,
          amountReason: differs ? body.amountReason! : (body.amountReason ?? null),
          amountSetBy: ctx.user.id,
          amountDueCents: amount,
          windowEnds: addDays(today, f.windowDays),
        })
        .returning();
      await log({
        action: 'settlement.declare',
        entity: 'book_settlement',
        entityId: s!.id,
        branchId: f.loan.branchId,
        after: {
          loanId,
          memberId: f.loan.userId,
          accessionNo: f.copy.accessionNo,
          kind: body.kind,
          reason: body.reason,
          tariffCents: f.tariffCents,
          amountCents: amount,
          amountReason: s!.amountReason,
          windowEnds: s!.windowEnds,
        },
      });
      return this.one(tx, s!.id);
    });
  }

  // ─── Clearing (FR-LST-05 to FR-LST-07) ─────────────────────────────────────

  async pay(
    ctx: AuthContext,
    id: number,
    body: { amountCents: number; receiptNo: string; paidOn?: string },
  ): Promise<Settlement> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const s = await this.lockOpen(tx, ctx, id);
      if (body.amountCents !== s.amountDueCents) throw refuse('amount_mismatch', 'unprocessable');
      const paidOn = paperDate(body.paidOn);
      const [p] = await tx
        .insert(settlementPayment)
        .values({
          settlementId: id,
          kind: 'payment',
          amountCents: body.amountCents,
          paidOn,
          receiptNo: body.receiptNo,
          collectedBy: ctx.user.id,
        })
        .returning();
      await tx
        .update(bookSettlement)
        .set({ status: 'paid', settledOn: paidOn, handledBy: ctx.user.id })
        .where(eq(bookSettlement.id, id));
      await log({
        action: 'settlement.pay',
        entity: 'book_settlement',
        entityId: id,
        branchId: s.branchId,
        before: { status: 'open' },
        after: {
          status: 'paid',
          paymentId: p!.id,
          amountCents: body.amountCents,
          receiptNo: body.receiptNo,
          paidOn,
        },
      });
      await liftIfClear(tx, log, s.userId, todayColombo());
      return this.one(tx, id);
    });
  }

  /**
   * FR-LST-05, FR-LST-06: staff have checked the book is the same title in
   * acceptable condition. It becomes a new copy of that title, numbered for the
   * branch that owned the lost one; the lost copy stays written off.
   */
  async replace(
    ctx: AuthContext,
    id: number,
    body: { source?: string; priceCents?: number },
  ): Promise<Settlement> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const s = await this.lockOpen(tx, ctx, id);
      const [lost] = await tx
        .select({
          accessionNo: copy.accessionNo,
          titleId: copy.titleId,
          category: title.categoryCode,
        })
        .from(copy)
        .innerJoin(title, eq(title.id, copy.titleId))
        .where(eq(copy.id, s.copyId));
      const [accessionNo] = await allocateAccessionNumbers(tx, s.copyBranchId, lost!.category, 1);
      const source = body.source?.trim() || `Replacement for ${lost!.accessionNo}`;
      const [added] = await tx
        .insert(copy)
        .values({
          accessionNo: accessionNo!,
          titleId: lost!.titleId,
          branchId: s.copyBranchId,
          accessionedBranchId: s.copyBranchId,
          source,
          priceCents: body.priceCents ?? null,
        })
        .returning();
      await log({
        action: 'copy.create',
        entity: 'copy',
        entityId: added!.id,
        branchId: s.copyBranchId,
        after: {
          titleId: lost!.titleId,
          accessionNumbers: [accessionNo],
          source,
          replaces: lost!.accessionNo,
          settlementId: id,
        },
      });
      const today = todayColombo();
      await tx
        .update(bookSettlement)
        .set({
          status: 'replaced',
          settledOn: today,
          handledBy: ctx.user.id,
          replacementCopyId: added!.id,
        })
        .where(eq(bookSettlement.id, id));
      await log({
        action: 'settlement.replace',
        entity: 'book_settlement',
        entityId: id,
        branchId: s.branchId,
        before: { status: 'open' },
        after: { status: 'replaced', replacementCopyId: added!.id, accessionNo },
      });
      await liftIfClear(tx, log, s.userId, today);
      return this.one(tx, id);
    });
  }

  // ─── The super admin's decisions (FR-LST-09) ───────────────────────────────

  async waive(ctx: AuthContext, id: number, reason: string): Promise<Settlement> {
    superOnly(ctx);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const s = await this.lockOpen(tx, ctx, id);
      const today = todayColombo();
      await tx
        .update(bookSettlement)
        .set({ status: 'waived', settledOn: today, handledBy: ctx.user.id, waiverReason: reason })
        .where(eq(bookSettlement.id, id));
      await log({
        action: 'settlement.waive',
        entity: 'book_settlement',
        entityId: id,
        branchId: s.branchId,
        before: { status: 'open', amountDueCents: s.amountDueCents },
        after: { status: 'waived', reason },
      });
      await liftIfClear(tx, log, s.userId, today);
      return this.one(tx, id);
    });
  }

  async reduce(
    ctx: AuthContext,
    id: number,
    body: { amountCents: number; reason: string },
  ): Promise<Settlement> {
    superOnly(ctx);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const s = await this.lockOpen(tx, ctx, id);
      if (body.amountCents <= 0 || body.amountCents >= s.amountDueCents) {
        throw refuse('amount_not_lower', 'unprocessable');
      }
      await tx
        .update(bookSettlement)
        .set({ amountDueCents: body.amountCents, reductionReason: body.reason })
        .where(eq(bookSettlement.id, id));
      await log({
        action: 'settlement.reduce',
        entity: 'book_settlement',
        entityId: id,
        branchId: s.branchId,
        before: { amountDueCents: s.amountDueCents, setAmountCents: s.setAmountCents },
        after: { amountDueCents: body.amountCents, reason: body.reason },
      });
      return this.one(tx, id);
    });
  }

  /** Once, by a number of days; extending a passed window lifts the suspension. */
  async extend(
    ctx: AuthContext,
    id: number,
    body: { days: number; reason: string },
  ): Promise<Settlement> {
    superOnly(ctx);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const s = await this.lockOpen(tx, ctx, id);
      if (s.windowExtendedDays !== null) throw refuse('window_extended');
      const windowEnds = addDays(s.windowEnds, body.days);
      await tx
        .update(bookSettlement)
        .set({ windowEnds, windowExtendedDays: body.days, windowExtensionReason: body.reason })
        .where(eq(bookSettlement.id, id));
      await log({
        action: 'settlement.extend',
        entity: 'book_settlement',
        entityId: id,
        branchId: s.branchId,
        before: { windowEnds: s.windowEnds },
        after: { windowEnds, days: body.days, reason: body.reason },
      });
      await liftIfClear(tx, log, s.userId, todayColombo());
      return this.one(tx, id);
    });
  }

  /**
   * FR-LST-07, FR-LST-12: a payment is never changed; a reversing entry undoes
   * it. Reversing a mistaken payment opens the settlement again; once the copy
   * has been found, the reversal is the refund and the settlement closes as found.
   */
  async reversePayment(
    ctx: AuthContext,
    id: number,
    paymentId: number,
    reason: string,
  ): Promise<Settlement> {
    superOnly(ctx);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const s = await this.lock(tx, ctx, id);
      const [p] = await tx
        .select()
        .from(settlementPayment)
        .where(and(eq(settlementPayment.id, paymentId), eq(settlementPayment.settlementId, id)));
      if (!p || p.kind !== 'payment') throw refuse('settlement_not_paid', 'unprocessable');
      const today = todayColombo();
      let reversal;
      try {
        [reversal] = await tx
          .insert(settlementPayment)
          .values({
            settlementId: id,
            kind: 'reversal',
            amountCents: -p.amountCents,
            paidOn: today,
            collectedBy: ctx.user.id,
            reason,
            reversesPaymentId: p.id,
          })
          .returning();
      } catch (err) {
        if (isPgError(err, PG.uniqueViolation, 'settlement_payment_reversed_once')) {
          throw refuse('payment_reversed');
        }
        throw err;
      }
      const next =
        s.status !== 'paid' ? s.status : s.foundOn ? ('found' as const) : ('open' as const);
      if (next !== s.status) {
        await tx
          .update(bookSettlement)
          .set(
            next === 'open'
              ? { status: 'open', settledOn: null, handledBy: null }
              : { status: 'found', handledBy: ctx.user.id },
          )
          .where(eq(bookSettlement.id, id));
      }
      await log({
        action: 'settlement.reverse_payment',
        entity: 'book_settlement',
        entityId: id,
        branchId: s.branchId,
        before: { status: s.status, paymentId: p.id, amountCents: p.amountCents },
        after: { status: next, reversalId: reversal!.id, reason },
      });
      return this.one(tx, id);
    });
  }

  /**
   * FR-LST-12: a copy recorded as missing turns up and goes back on the shelf.
   * An open settlement for it closes as found; a paid one is shown with it, so
   * the library can decide about a refund (a reversing entry).
   */
  async found(
    ctx: AuthContext,
    copyId: number,
    reason: string,
  ): Promise<{ settlement: Settlement | null }> {
    superOnly(ctx);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [c] = await tx.select().from(copy).where(eq(copy.id, copyId)).for('update');
      if (!c) throw AppError.notFound('copy_not_found', 'No such copy.');
      if (c.condition !== 'missing') throw refuse('copy_not_lost');
      await tx.update(copy).set({ condition: 'useable' }).where(eq(copy.id, copyId));
      await log({
        action: 'copy.found',
        entity: 'copy',
        entityId: copyId,
        branchId: c.branchId,
        before: { condition: 'missing' },
        after: { condition: 'useable', accessionNo: c.accessionNo, reason },
      });
      const [s] = await tx
        .select()
        .from(bookSettlement)
        .where(and(eq(bookSettlement.copyId, copyId), eq(bookSettlement.kind, 'lost')))
        .orderBy(sql`${bookSettlement.id} DESC`)
        .limit(1)
        .for('update');
      if (!s || s.foundOn) return { settlement: null };
      const today = todayColombo();
      const closes = s.status === 'open';
      await tx
        .update(bookSettlement)
        .set({
          foundOn: today,
          foundReason: reason,
          ...(closes ? { status: 'found' as const, settledOn: today, handledBy: ctx.user.id } : {}),
        })
        .where(eq(bookSettlement.id, s.id));
      await log({
        action: 'settlement.found',
        entity: 'book_settlement',
        entityId: s.id,
        branchId: s.branchId,
        before: { status: s.status },
        after: { status: closes ? 'found' : s.status, foundOn: today, reason },
      });
      if (closes) await liftIfClear(tx, log, s.userId, today);
      return { settlement: await this.one(tx, s.id) };
    });
  }

  // ─── Reading (FR-LST-03, FR-LST-10, FR-LST-13) ─────────────────────────────

  async detail(ctx: AuthContext, id: number): Promise<Settlement> {
    const s = await this.one(this.db, id);
    assertEither(ctx.user, s.memberBranch.id, s.copyBranch.id);
    return s;
  }

  /** Every settlement a member has had, open and cleared (FR-LST-13). */
  async forMember(ctx: AuthContext, memberId: number): Promise<Settlement[]> {
    const [m] = await this.db
      .select({ branchId: appUser.branchId, userType: appUser.userType })
      .from(appUser)
      .where(eq(appUser.id, memberId));
    if (!m || m.userType !== 'member') {
      throw AppError.notFound('member_not_found', 'No such member.');
    }
    assertBranchAccess(ctx.user, m.branchId);
    return settlementsWhere(this.db, eq(bookSettlement.userId, memberId), todayColombo());
  }

  async mine(ctx: AuthContext): Promise<Settlement[]> {
    if (ctx.user.userType !== 'member') {
      throw AppError.forbidden('members_only', 'Only members have settlements.');
    }
    return settlementsWhere(this.db, eq(bookSettlement.userId, ctx.user.id), todayColombo());
  }

  /** FR-LST-10: each branch's open settlements, windows passed first, and the recently cleared. */
  async board(ctx: AuthContext, only: number | null): Promise<SettlementBoard> {
    const today = todayColombo();
    if (only !== null) assertBranchAccess(ctx.user, only);
    const scope = only ?? (ctx.user.userType === 'super_admin' ? null : ctx.user.branchId);
    const branches = await this.db
      .select({ branchId: branch.id, branchCode: branch.branchCode, branchName: branch.branchName })
      .from(branch)
      .where(scope === null ? undefined : eq(branch.id, scope))
      .orderBy(asc(branch.branchCode));
    const ids = branches.map((b) => b.branchId);
    if (ids.length === 0) return { today, branches: [] };
    const all = await settlementsWhere(
      this.db,
      and(
        inArray(bookSettlement.branchId, ids),
        or(
          eq(bookSettlement.status, 'open'),
          gte(bookSettlement.settledOn, addDays(today, -RECENT_DAYS)),
        ),
      ),
      today,
    );
    return {
      today,
      branches: branches.map((b) => {
        const mine = all.filter((s) => s.memberBranch.id === b.branchId);
        return {
          ...b,
          open: mine
            .filter((s) => s.status === 'open')
            .toSorted((x, y) => x.daysLeft - y.daysLeft || x.id - y.id),
          recent: mine.filter((s) => s.status !== 'open'),
        };
      }),
    };
  }

  /** Open settlements of the given members (for panels and the member page). */
  openFor(q: Queryable, userId: number, today: string): Promise<Settlement[]> {
    return settlementsWhere(
      q,
      and(eq(bookSettlement.userId, userId), eq(bookSettlement.status, 'open')),
      today,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** The loan, copy, tariff and window behind a declaration; the loan must be open. */
  private async lossFacts(q: Queryable, ctx: AuthContext, loanId: number, lock: boolean) {
    const loanQuery = q.select().from(borrow).where(eq(borrow.id, loanId));
    const [loan] = lock ? await loanQuery.for('update') : await loanQuery;
    if (!loan) throw AppError.notFound('loan_not_found', 'No such loan.');
    assertBranchAccess(ctx.user, loan.branchId);
    if (loan.voidedAt || loan.returnedOn) throw refuse('loan_not_open');
    const copyQuery = q.select().from(copy).where(eq(copy.id, loan.copyId));
    const [c] = lock ? await copyQuery.for('update') : await copyQuery;
    const [t] = await q
      .select({ categoryCode: title.categoryCode })
      .from(title)
      .where(eq(title.id, c!.titleId));
    const [owner] = await q
      .select({ id: branch.id, code: branch.branchCode, name: branch.branchName })
      .from(branch)
      .where(eq(branch.id, c!.branchId));
    const [tariff] = await q
      .select({ amountCents: lostTariff.amountCents })
      .from(lostTariff)
      .where(
        and(eq(lostTariff.branchId, c!.branchId), eq(lostTariff.categoryCode, t!.categoryCode)),
      );
    const [rules] = await q
      .select({ windowDays: branchSetting.settlementWindowDays })
      .from(branchSetting)
      .where(eq(branchSetting.branchId, loan.branchId));
    return {
      loan,
      copy: c!,
      copyBranch: owner!,
      categoryCode: t!.categoryCode,
      tariffCents: tariff?.amountCents ?? null,
      windowDays: rules?.windowDays ?? 100,
    };
  }

  private async lock(tx: Tx, ctx: AuthContext, id: number): Promise<SettlementRow> {
    const [s] = await tx
      .select()
      .from(bookSettlement)
      .where(eq(bookSettlement.id, id))
      .for('update');
    if (!s) throw refuse('settlement_not_found');
    assertEither(ctx.user, s.branchId, s.copyBranchId);
    return s;
  }

  private async lockOpen(tx: Tx, ctx: AuthContext, id: number): Promise<SettlementRow> {
    const s = await this.lock(tx, ctx, id);
    if (s.status !== 'open') throw refuse('settlement_closed');
    return s;
  }

  private async one(q: Queryable, id: number): Promise<Settlement> {
    const [s] = await settlementsWhere(q, eq(bookSettlement.id, id), todayColombo());
    if (!s) throw AppError.notFound('settlement_not_found', MESSAGES.settlement_not_found);
    return s;
  }
}

/** Staff of the member's branch or of the branch that owned the copy; super admins anywhere. */
function assertEither(user: UserRow, a: number, b: number): void {
  if (user.userType === 'super_admin') return;
  if (user.branchId === a || user.branchId === b) return;
  throw AppError.forbidden('other_branch', 'This belongs to another branch.');
}

/** A payment taken today, or entered later from a paper receipt (FR-CIR-14's window). */
function paperDate(input: string | undefined): string {
  const today = todayColombo();
  if (input === undefined) return today;
  if (input > today) throw AppError.badRequest('date_in_future', 'That date has not happened yet.');
  if (input < addDays(today, -BACKDATE_MAX_DAYS)) {
    throw AppError.badRequest(
      'backdate_too_old',
      `Paper transactions can be entered up to ${BACKDATE_MAX_DAYS} days back.`,
    );
  }
  return input;
}

/** For the catalogue: a copy written off by a settlement or lost in transit returns only via `found`. */
export async function writtenOff(q: Queryable, copyId: number): Promise<boolean> {
  const [s] = await q
    .select({ id: bookSettlement.id })
    .from(bookSettlement)
    .where(and(eq(bookSettlement.copyId, copyId), sql`${bookSettlement.foundOn} IS NULL`))
    .limit(1);
  if (s) return true;
  const [r] = await q
    .select({ id: bookRequest.id })
    .from(bookRequest)
    .where(and(eq(bookRequest.copyId, copyId), eq(bookRequest.status, 'lost_in_transit')))
    .limit(1);
  return r !== undefined;
}
