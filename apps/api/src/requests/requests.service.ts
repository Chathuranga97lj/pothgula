import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  type BookRequest,
  type BookRequestDetail,
  type BranchRequests,
  daysBetween,
  loanStanding,
  OPEN_REQUEST_STATUSES,
  type RequestBoard,
  type RequestStatus,
  nextOpenDay,
  todayColombo,
} from '@pothgula/shared';
import { and, asc, desc, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type Log, UnitOfWork } from '../audit/unit-of-work';
import type { AuthContext } from '../auth/auth-context';
import type { UserRow } from '../auth/users';
import { loanColumns, loanQuery, toLoan } from '../circulation/loan-view';
import { AppError } from '../common/app-error';
import { isPgError, PG } from '../common/pg-error';
import { assertBranchAccess, branchScope } from '../common/scope';
import type { Db, Queryable, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, bookRequest, borrow, branch, branchSetting, copy, title } from '../db/schema';
import { MembersService } from '../members/members.service';
import { REFUSAL_MESSAGES } from '../circulation/issue-rules';
import { REQUEST_MESSAGES, type RequestRefusal, requestRefusals } from './request-rules';
import { timetable } from '../schedule/hours.service';
import { effectiveStatus, isSettling, settlementStanding } from '../settlements/suspension';

type RequestRow = typeof bookRequest.$inferSelect;

const fromBranch = alias(branch, 'from_branch');
const toBranch = alias(branch, 'to_branch');

const notFound = () => AppError.notFound('request_not_found', REQUEST_MESSAGES.request_not_found);
const wrongStep = () => AppError.conflict('wrong_step', REQUEST_MESSAGES.wrong_step);

function refuse(refusals: RequestRefusal[]): never {
  const first = refusals[0]!;
  const message =
    (REQUEST_MESSAGES as Record<string, string>)[first] ??
    (REFUSAL_MESSAGES as Record<string, string>)[first] ??
    first;
  throw AppError.unprocessable(first, message, { refusals: refusals.map((code) => ({ code })) });
}

/**
 * §8: books from other branches. A member asks for a title on the shelf at
 * another branch; that branch accepts (choosing the copy) or declines; the copy
 * is sent, arrives and is held at the member's branch, issued there as an
 * ordinary loan, and travels home when it comes back — or when the hold lapses.
 * Every step is logged in the same transaction (FR-REQ-10), against the branch
 * where it happens. Whether a copy is in transit or held is worked out from these
 * rows by the copy_availability view.
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly members: MembersService,
  ) {}

  // ─── The member (FR-REQ-01, FR-REQ-02, FR-REQ-11) ──────────────────────────

  async create(
    ctx: AuthContext,
    body: { titleId: number; fromBranchId: number },
  ): Promise<BookRequest> {
    if (ctx.user.userType !== 'member') {
      throw AppError.forbidden('members_only', 'Only members ask for books from other branches.');
    }
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [member] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, ctx.user.id))
        .for('update');
      const [t] = await tx.select().from(title).where(eq(title.id, body.titleId));
      if (!t || t.mergedIntoId !== null) {
        throw AppError.notFound('title_not_found', 'That book is not in the catalogue.');
      }
      const [b] = await tx.select().from(branch).where(eq(branch.id, body.fromBranchId));
      if (!b) throw AppError.notFound('branch_not_found', 'No such branch.');

      const refusals = await this.refusalsFor(tx, member!, body.titleId, body.fromBranchId, null);
      if (refusals.length > 0) refuse(refusals);

      let row: RequestRow | undefined;
      try {
        [row] = await tx
          .insert(bookRequest)
          .values({
            titleId: body.titleId,
            userId: member!.id,
            fromBranchId: body.fromBranchId,
            toBranchId: member!.branchId!,
          })
          .returning();
      } catch (err) {
        if (isPgError(err, PG.uniqueViolation, 'book_request_one_open_per_member')) {
          refuse(['request_open']);
        }
        throw err;
      }
      await log({
        action: 'request.create',
        entity: 'book_request',
        entityId: row!.id,
        branchId: row!.fromBranchId,
        after: {
          titleId: row!.titleId,
          fromBranchId: row!.fromBranchId,
          toBranchId: row!.toBranchId,
        },
      });
      return this.view(tx, row!.id);
    });
  }

  /** FR-REQ-11: until it is accepted. */
  cancel(ctx: AuthContext, id: number): Promise<BookRequest> {
    return this.step(ctx, id, async (tx, log, r) => {
      if (ctx.user.userType !== 'member' || r.userId !== ctx.user.id) throw notFound();
      if (r.status !== 'requested') throw wrongStep();
      await tx
        .update(bookRequest)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(bookRequest.id, id));
      await this.logStep(log, r, 'request.cancel', 'cancelled', r.fromBranchId);
    });
  }

  /** The member's own requests, the latest first. */
  async mine(ctx: AuthContext): Promise<BookRequest[]> {
    const rows = await this.query(this.db, eq(bookRequest.userId, ctx.user.id))
      .orderBy(desc(bookRequest.requestedAt))
      .limit(20);
    return this.toViews(this.db, rows);
  }

  // ─── The holding branch (FR-REQ-04) ────────────────────────────────────────

  /** Accepting is choosing the copy to send; it leaves the shelf at once. */
  accept(ctx: AuthContext, id: number, copyId: number): Promise<BookRequest> {
    return this.step(ctx, id, async (tx, log, r) => {
      assertBranchAccess(ctx.user, r.fromBranchId);
      if (r.status !== 'requested') throw wrongStep();
      // FR-REQ-02: the member must still be able to borrow, now.
      const [member] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, r.userId))
        .for('update');
      const refusals = (
        await this.refusalsFor(tx, member!, r.titleId, r.fromBranchId, r.id)
      ).filter((c) => c !== 'none_on_shelf');
      if (refusals.length > 0) refuse(refusals);

      const [c] = await tx.select().from(copy).where(eq(copy.id, copyId)).for('update');
      const state = c ? await this.copyState(tx, c.id) : null;
      if (!c || c.titleId !== r.titleId || c.branchId !== r.fromBranchId || state !== 'on_shelf') {
        throw AppError.unprocessable('copy_not_on_shelf', REQUEST_MESSAGES.copy_not_on_shelf);
      }
      try {
        await tx
          .update(bookRequest)
          .set({ status: 'accepted', copyId, decidedBy: ctx.user.id, decidedAt: new Date() })
          .where(eq(bookRequest.id, id));
      } catch (err) {
        if (isPgError(err, PG.uniqueViolation, 'book_request_one_per_copy')) {
          throw AppError.unprocessable('copy_not_on_shelf', REQUEST_MESSAGES.copy_not_on_shelf);
        }
        throw err;
      }
      await this.logStep(log, r, 'request.accept', 'accepted', r.fromBranchId, {
        copyId,
        accessionNo: c.accessionNo,
      });
    });
  }

  decline(ctx: AuthContext, id: number, reason: string): Promise<BookRequest> {
    return this.step(ctx, id, async (tx, log, r) => {
      assertBranchAccess(ctx.user, r.fromBranchId);
      if (r.status !== 'requested') throw wrongStep();
      await tx
        .update(bookRequest)
        .set({
          status: 'declined',
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          declineReason: reason,
        })
        .where(eq(bookRequest.id, id));
      await this.logStep(log, r, 'request.decline', 'declined', r.fromBranchId, { reason });
    });
  }

  // ─── The journey (FR-REQ-05 to FR-REQ-07, FR-REQ-13, FR-REQ-14) ──────────────

  /**
   * FR-REQ-13: one dispatch of any number of copies — accepted ones leaving their
   * owner, and ones going home from the member's branch (returned, or a lapsed
   * hold). Each sender must be staff of the branch the copy leaves.
   */
  async dispatch(ctx: AuthContext, ids: number[]): Promise<BookRequest[]> {
    const unique = [...new Set(ids)];
    return this.uow.run(ctx.actor, async (tx, log) => {
      const today = todayColombo();
      const rows = await tx
        .select()
        .from(bookRequest)
        .where(inArray(bookRequest.id, unique))
        .orderBy(asc(bookRequest.id))
        .for('update');
      if (rows.length !== unique.length) throw notFound();
      const now = new Date();
      for (const r of rows) {
        if (r.status === 'accepted') {
          assertBranchAccess(ctx.user, r.fromBranchId);
          await tx
            .update(bookRequest)
            .set({ status: 'in_transit', dispatchedAt: now })
            .where(eq(bookRequest.id, r.id));
          await this.logStep(log, r, 'request.dispatch', 'in_transit', r.fromBranchId);
          continue;
        }
        const heldPast = r.status === 'held' && r.holdUntil !== null && r.holdUntil < today;
        const goingHome =
          r.status === 'lapsed' || heldPast || (r.status === 'returning' && !r.returnDispatchedAt);
        if (!goingHome) {
          throw r.status === 'held'
            ? AppError.conflict('hold_not_over', REQUEST_MESSAGES.hold_not_over)
            : wrongStep();
        }
        assertBranchAccess(ctx.user, r.toBranchId);
        if (heldPast) await this.lapseOne(tx, log, r);
        await tx
          .update(bookRequest)
          .set({ status: 'returning', returnDispatchedAt: now })
          .where(eq(bookRequest.id, r.id));
        await this.logStep(log, r, 'request.return_dispatch', 'returning', r.toBranchId);
      }
      return this.toViews(
        tx,
        await this.query(tx, inArray(bookRequest.id, unique)).orderBy(asc(bookRequest.id)),
      );
    });
  }

  /**
   * The receiving branch records an arrival: at the member's branch the copy is
   * held for them (FR-REQ-05); back at its owner it is on the shelf (FR-REQ-06, 07).
   */
  arrive(ctx: AuthContext, id: number): Promise<BookRequest> {
    return this.step(ctx, id, async (tx, log, r) => {
      const now = new Date();
      if (r.status === 'in_transit') {
        assertBranchAccess(ctx.user, r.toBranchId);
        const today = todayColombo();
        const [s] = await tx
          .select({ holdDays: branchSetting.holdDays })
          .from(branchSetting)
          .where(eq(branchSetting.branchId, r.toBranchId));
        // A hold never ends on a day the branch is closed: it runs to the next opening day.
        const last = addDays(today, s?.holdDays ?? 7);
        const holdUntil = nextOpenDay(last, await timetable(tx, r.toBranchId, last, 31));
        await tx
          .update(bookRequest)
          .set({ status: 'held', arrivedAt: now, holdUntil })
          .where(eq(bookRequest.id, id));
        await this.logStep(log, r, 'request.arrive', 'held', r.toBranchId, { holdUntil });
        return;
      }
      if (r.status === 'returning' && r.returnDispatchedAt) {
        assertBranchAccess(ctx.user, r.fromBranchId);
        await tx
          .update(bookRequest)
          .set({ status: 'completed', returnArrivedAt: now })
          .where(eq(bookRequest.id, id));
        await this.logStep(log, r, 'request.return_arrive', 'completed', r.fromBranchId);
        return;
      }
      throw wrongStep();
    });
  }

  /**
   * FR-REQ-14: a copy that never arrived is the library's loss. A super admin
   * marks it missing with a reason; no member owes anything; the request closes.
   */
  markLost(ctx: AuthContext, id: number, reason: string): Promise<BookRequest> {
    return this.step(ctx, id, async (tx, log, r) => {
      const onTheRoad =
        r.status === 'in_transit' || (r.status === 'returning' && r.returnDispatchedAt !== null);
      if (!onTheRoad) throw wrongStep();
      await tx
        .update(bookRequest)
        .set({ status: 'lost_in_transit', lostReason: reason })
        .where(eq(bookRequest.id, id));
      const [c] = await tx.select().from(copy).where(eq(copy.id, r.copyId!)).for('update');
      await tx.update(copy).set({ condition: 'missing' }).where(eq(copy.id, c!.id));
      await log({
        action: 'copy.update',
        entity: 'copy',
        entityId: c!.id,
        branchId: c!.branchId,
        before: { condition: c!.condition },
        after: { condition: 'missing', accessionNo: c!.accessionNo, lostInTransit: id },
      });
      await this.logStep(log, r, 'request.lost', 'lost_in_transit', r.fromBranchId, { reason });
    });
  }

  // ─── Reading (FR-REQ-03, FR-REQ-09) ────────────────────────────────────────

  /** One request with its member in full, for staff of either branch (FR-REQ-03). */
  async detail(ctx: AuthContext, id: number): Promise<BookRequestDetail> {
    const [r] = await this.db.select().from(bookRequest).where(eq(bookRequest.id, id));
    if (!r) throw notFound();
    const scope = branchScope(ctx.user);
    if (scope !== null && scope !== r.fromBranchId && scope !== r.toBranchId) {
      throw AppError.forbidden('other_branch', 'This belongs to another branch.');
    }
    const view = await this.view(this.db, id);
    const [member] = await this.db.select().from(appUser).where(eq(appUser.id, r.userId));
    const today = todayColombo();
    const loanRows = await loanQuery(this.db)
      .where(and(eq(borrow.userId, r.userId), isNull(borrow.voidedAt)))
      .orderBy(desc(borrow.borrowDate));
    const loans = loanRows.map((l) => toLoan(l, today));
    const [rules] = await this.db
      .select({ months: branchSetting.frequentLateMonths })
      .from(branchSetting)
      .where(eq(branchSetting.branchId, r.toBranchId));
    const months = rules?.months ?? 12;
    const standing = loanStanding(
      loans.map((l) => ({ ...l, voided: false, lost: l.status === 'lost' })),
      today,
      { maxBooks: 1, frequentLateCount: 1, frequentLateMonths: months },
    );
    return {
      ...view,
      member: await this.members.detailOf(this.db, member as UserRow),
      memberLoans: loans.filter((l) => l.status === 'open'),
      lateReturns: standing.lateReturns,
      lateReturnMonths: months,
    };
  }

  /** FR-REQ-09: each branch's requests, by what needs doing there. */
  async board(ctx: AuthContext, branchId: number | null): Promise<RequestBoard> {
    if (branchId !== null) assertBranchAccess(ctx.user, branchId);
    const scope = branchId ?? branchScope(ctx.user);
    const today = todayColombo();
    const branches = await this.db
      .select({ branchId: branch.id, branchCode: branch.branchCode, branchName: branch.branchName })
      .from(branch)
      .where(scope === null ? undefined : eq(branch.id, scope))
      .orderBy(asc(branch.branchCode));
    const ids = branches.map((b) => b.branchId);
    if (ids.length === 0) return { today, branches: [] };

    const live: RequestStatus[] = [...OPEN_REQUEST_STATUSES, 'issued', 'lapsed', 'returning'];
    const rows = await this.query(
      this.db,
      and(
        inArray(bookRequest.status, live),
        or(inArray(bookRequest.fromBranchId, ids), inArray(bookRequest.toBranchId, ids)),
      )!,
    ).orderBy(asc(bookRequest.requestedAt));
    const views = await this.toViews(this.db, rows);

    // FR-REQ-09: a branch's own copies out on loan at other branches.
    const elsewhere = await this.db
      .select({ ...loanColumns, copyBranchId: copy.branchId })
      .from(borrow)
      .innerJoin(copy, eq(copy.id, borrow.copyId))
      .innerJoin(title, eq(title.id, copy.titleId))
      .innerJoin(appUser, eq(appUser.id, borrow.userId))
      .where(
        and(
          isNull(borrow.returnedOn),
          isNull(borrow.voidedAt),
          inArray(copy.branchId, ids),
          ne(borrow.branchId, copy.branchId),
        ),
      );
    const outLoans = elsewhere.map((l) => ({ loan: toLoan(l, today), owner: l.copyBranchId }));

    return {
      today,
      branches: branches.map((b): BranchRequests => {
        const at = (pred: (v: BookRequest) => boolean) => views.filter(pred);
        const id = b.branchId;
        return {
          ...b,
          toDecide: at((v) => v.from.id === id && v.status === 'requested'),
          toSend: at(
            (v) =>
              (v.from.id === id && v.status === 'accepted') ||
              (v.to.id === id &&
                (v.status === 'lapsed' ||
                  (v.status === 'returning' && v.returnDispatchedAt === null) ||
                  (v.status === 'held' && v.holdUntil !== null && v.holdUntil < today))),
          ),
          arriving: at(
            (v) =>
              (v.to.id === id && v.status === 'in_transit') ||
              (v.from.id === id && v.status === 'returning' && v.returnDispatchedAt !== null),
          ),
          held: at(
            (v) => v.to.id === id && v.status === 'held' && (v.holdUntil ?? today) >= today,
          ).toSorted((a, c) => (a.holdUntil ?? '').localeCompare(c.holdUntil ?? '')),
          ourMembers: at(
            (v) => v.to.id === id && OPEN_REQUEST_STATUSES.includes(v.status as never),
          ),
          outElsewhere: outLoans
            .filter((o) => o.owner === id)
            .map((o) => o.loan)
            .toSorted((a, c) => a.dueDate.localeCompare(c.dueDate)),
          transitOverdue: at((v) => v.transitOverdue && (v.from.id === id || v.to.id === id)),
        };
      }),
    };
  }

  /** For the transit slip: the requests, checked against the caller's branches. */
  async forSlip(ctx: AuthContext, ids: number[]): Promise<BookRequest[]> {
    const rows = await this.query(this.db, inArray(bookRequest.id, ids)).orderBy(
      asc(bookRequest.id),
    );
    const scope = branchScope(ctx.user);
    if (rows.length === 0) throw notFound();
    for (const r of rows) {
      if (scope !== null && scope !== r.request.fromBranchId && scope !== r.request.toBranchId) {
        throw AppError.forbidden('other_branch', 'This belongs to another branch.');
      }
    }
    return this.toViews(this.db, rows);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Locks the request, applies one step and logs it, then answers it as it now is. */
  private step(
    ctx: AuthContext,
    id: number,
    apply: (tx: Tx, log: Log, r: RequestRow) => Promise<void>,
  ): Promise<BookRequest> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [r] = await tx.select().from(bookRequest).where(eq(bookRequest.id, id)).for('update');
      if (!r) throw notFound();
      await apply(tx, log, r);
      return this.view(tx, id);
    });
  }

  private async lapseOne(tx: Tx, log: Log, r: RequestRow): Promise<void> {
    await tx
      .update(bookRequest)
      .set({ status: 'lapsed', lapsedAt: new Date() })
      .where(eq(bookRequest.id, r.id));
    await this.logStep(log, r, 'request.lapse', 'lapsed', r.toBranchId, { holdUntil: r.holdUntil });
  }

  private logStep(
    log: Log,
    r: RequestRow,
    action: string,
    status: RequestStatus,
    branchId: number,
    extra: object = {},
  ): Promise<void> {
    return log({
      action,
      entity: 'book_request',
      entityId: r.id,
      branchId,
      before: { status: r.status },
      after: { status, ...extra },
    });
  }

  /**
   * FR-REQ-02: every reason this member cannot have a request for this title from
   * this branch now, `except` being the request under decision.
   */
  private async refusalsFor(
    q: Queryable,
    member: UserRow,
    titleId: number,
    fromBranchId: number,
    except: number | null,
  ): Promise<RequestRefusal[]> {
    const today = todayColombo();
    const shelf = await q.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM copy c JOIN copy_availability a ON a.copy_id = c.id
      WHERE c.title_id = ${titleId} AND c.branch_id = ${fromBranchId} AND a.state = 'on_shelf'`);
    const open = await q
      .select({ id: bookRequest.id })
      .from(bookRequest)
      .where(
        and(
          eq(bookRequest.userId, member.id),
          inArray(bookRequest.status, [...OPEN_REQUEST_STATUSES]),
          except === null ? undefined : ne(bookRequest.id, except),
        ),
      );
    const loans = await q.select().from(borrow).where(eq(borrow.userId, member.id));
    const [rules] = await q
      .select()
      .from(branchSetting)
      .where(eq(branchSetting.branchId, member.branchId ?? -1));
    const standing = loanStanding(
      loans.map((b) => ({
        dueDate: b.dueDate,
        returnedOn: b.returnedOn,
        voided: b.voidedAt !== null,
        extensionStatus: b.extensionStatus,
        lost: b.lostDeclaredAt !== null,
      })),
      today,
      {
        maxBooks: rules?.maxBooks ?? 2,
        frequentLateCount: rules?.frequentLateCount ?? 3,
        frequentLateMonths: rules?.frequentLateMonths ?? 12,
      },
    );
    // FR-LST-04, FR-LST-15: an open settlement lowers the limit; a passed window suspends.
    const settling = await settlementStanding(q, member.id, today);
    return requestRefusals({
      member: { ...member, status: effectiveStatus(member.status, settling) },
      fromBranchId,
      shelfCopies: shelf.rows[0]?.n ?? 0,
      standing,
      openRequests: open.length,
      today,
      ...(isSettling(settling) ? { settlingMaxBooks: rules?.maxBooksWhileSettling ?? 1 } : {}),
    });
  }

  private async copyState(q: Queryable, copyId: number) {
    const result = await q.execute<{ state: string }>(
      sql`SELECT state FROM copy_availability WHERE copy_id = ${copyId}`,
    );
    return result.rows[0]?.state ?? null;
  }

  private query(q: Queryable, where: SQL) {
    return q
      .select({
        request: bookRequest,
        title: title.title,
        writer: title.writer,
        accessionNo: copy.accessionNo,
        memberName: appUser.fullName,
        memberPhone: appUser.whatsappPhone,
        fromCode: fromBranch.branchCode,
        fromName: fromBranch.branchName,
        toCode: toBranch.branchCode,
        toName: toBranch.branchName,
      })
      .from(bookRequest)
      .innerJoin(title, eq(title.id, bookRequest.titleId))
      .leftJoin(copy, eq(copy.id, bookRequest.copyId))
      .innerJoin(appUser, eq(appUser.id, bookRequest.userId))
      .innerJoin(fromBranch, eq(fromBranch.id, bookRequest.fromBranchId))
      .innerJoin(toBranch, eq(toBranch.id, bookRequest.toBranchId))
      .where(where)
      .$dynamic();
  }

  private async view(q: Queryable, id: number): Promise<BookRequest> {
    const [row] = await this.query(q, eq(bookRequest.id, id));
    if (!row) throw notFound();
    return (await this.toViews(q, [row]))[0]!;
  }

  private async toViews(
    q: Queryable,
    rows: Awaited<ReturnType<RequestsService['query']>>,
  ): Promise<BookRequest[]> {
    const settings = await q
      .select({ branchId: branchSetting.branchId, days: branchSetting.transitAlertDays })
      .from(branchSetting);
    const alertDays = new Map(settings.map((s) => [s.branchId, s.days]));
    const today = todayColombo();
    return rows.map(({ request: r, ...x }) => {
      // On the road: out to the member's branch, or home to the owner.
      const leftAt =
        r.status === 'in_transit'
          ? r.dispatchedAt
          : r.status === 'returning'
            ? r.returnDispatchedAt
            : null;
      const days = leftAt ? daysBetween(todayColombo(leftAt), today) : null;
      const receiver = r.status === 'in_transit' ? r.toBranchId : r.fromBranchId;
      return {
        id: r.id,
        status: r.status,
        titleId: r.titleId,
        title: x.title,
        writer: x.writer,
        copyId: r.copyId,
        accessionNo: x.accessionNo,
        memberId: r.userId,
        memberName: x.memberName,
        memberPhone: x.memberPhone,
        from: { id: r.fromBranchId, code: x.fromCode, name: x.fromName },
        to: { id: r.toBranchId, code: x.toCode, name: x.toName },
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        declineReason: r.declineReason,
        dispatchedAt: r.dispatchedAt?.toISOString() ?? null,
        arrivedAt: r.arrivedAt?.toISOString() ?? null,
        holdUntil: r.holdUntil,
        borrowId: r.borrowId,
        returnDispatchedAt: r.returnDispatchedAt?.toISOString() ?? null,
        returnArrivedAt: r.returnArrivedAt?.toISOString() ?? null,
        daysInTransit: days,
        transitOverdue: days !== null && days > (alertDays.get(receiver) ?? 7),
        lostReason: r.lostReason,
      };
    });
  }
}
